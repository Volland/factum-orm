import { DiagramPage, Id, OrmModel, Shape } from './types.js';

/**
 * Diagram pages. Page 0 is `model.diagram` itself; page `n` is
 * `model.diagram.pages[n - 1]`. Pages are addressed by position because
 * nothing in the model refers to a page.
 */

export function pageCount(model: OrmModel): number {
  return 1 + (model.diagram.pages?.length ?? 0);
}

export function pageAt(model: OrmModel, index: number): DiagramPage {
  return index <= 0 ? model.diagram : model.diagram.pages?.[index - 1] ?? model.diagram;
}

/** The live shape record of a page; writing into it moves shapes on that page. */
export function pageShapes(model: OrmModel, index: number): Record<Id, Shape> {
  return pageAt(model, index).shapes;
}

export function pageName(model: OrmModel, index: number): string {
  const name = pageAt(model, index).name?.trim();
  if (name) return name;
  return index === 0 && pageCount(model) === 1 ? model.name : `Page ${index + 1}`;
}

export function clampPage(model: OrmModel, index: number): number {
  return Math.max(0, Math.min(pageCount(model) - 1, Math.floor(index) || 0));
}

/** Ids that have a shape, hidden or not, on at least one page. */
function placedIds(model: OrmModel): Set<Id> {
  const ids = new Set<Id>();
  for (let index = 0; index < pageCount(model); index += 1) {
    for (const id of Object.keys(pageShapes(model, index))) ids.add(id);
  }
  return ids;
}

/**
 * The id whose shape places an element. An entity type that objectifies a
 * fact type is drawn as the frame around it, so it goes where the fact type goes.
 */
export function shapeIdOf(model: OrmModel, id: Id): Id {
  const nested = model.objectTypes.find((o) => o.id === id)?.objectifiedFactTypeId;
  return nested && model.factTypes.some((ft) => ft.id === nested) ? nested : id;
}

// @lat: [[file-format#Diagram pages#Membership]]
/**
 * Whether a page draws an element. A visible shape on the page puts it there;
 * an element with no shape on any page falls on the first page, which is how
 * every single-page file has always behaved.
 */
export function isOnPage(model: OrmModel, index: number, id: Id, placed = placedIds(model)): boolean {
  const key = shapeIdOf(model, id);
  const shape = pageShapes(model, index)[key];
  if (shape) return !shape.hidden;
  return index === 0 && !placed.has(key);
}

/** Pages that draw an element, in order. */
export function pagesOf(model: OrmModel, id: Id): number[] {
  const placed = placedIds(model);
  const pages: number[] = [];
  for (let index = 0; index < pageCount(model); index += 1) {
    if (isOnPage(model, index, id, placed)) pages.push(index);
  }
  return pages;
}

/**
 * The model as one page draws it: only the elements on the page, with the
 * page as its diagram. The page's shape record is shared, not copied, so the
 * renderer, geometry and auto-layout work on a page without knowing of pages,
 * and a drag that writes into the view's shapes moves them on the page.
 *
 * Constraints are left whole: the renderer already skips a constraint whose
 * roles it cannot find, which is exactly a constraint reaching off the page.
 */
export function pageView(model: OrmModel, index: number): OrmModel {
  const page = pageAt(model, index);
  const placed = placedIds(model);
  const on = (id: Id): boolean => isOnPage(model, index, id, placed);
  const objectTypes = model.objectTypes.filter((ot) => on(ot.id));
  const drawn = new Set(objectTypes.map((ot) => ot.id));
  return {
    ...model,
    objectTypes,
    factTypes: model.factTypes.filter((ft) => on(ft.id)),
    subtypeRelations: model.subtypeRelations.filter((s) => drawn.has(s.subtypeId) && drawn.has(s.supertypeId)),
    diagram: { name: page.name, shapes: page.shapes },
  };
}

/* -------------------------------------------------------------------------- */
/* Page operations — each mutates the model it is given                        */
/* -------------------------------------------------------------------------- */

/** Appends an empty page and returns its index. */
export function addPage(model: OrmModel, name?: string): number {
  const index = pageCount(model);
  const pages = model.diagram.pages ?? [];
  pages.push({ name: name ?? uniquePageName(model, `Page ${index + 1}`), shapes: {} });
  model.diagram.pages = pages;
  return index;
}

function uniquePageName(model: OrmModel, base: string): string {
  const taken = new Set(Array.from({ length: pageCount(model) }, (_, i) => pageName(model, i)));
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base} (${n})`;
  return name;
}

export function renamePage(model: OrmModel, index: number, name: string): void {
  const page = pageAt(model, clampPage(model, index));
  const trimmed = name.trim();
  if (trimmed) page.name = trimmed;
  else delete page.name;
}

/**
 * Deletes a page. Elements drawn only there stay in the model, kept off the
 * diagram by a hidden shape on the first page — without one they would fall
 * back onto the first page, which is not what deleting a page means.
 */
export function deletePage(model: OrmModel, index: number): void {
  const count = pageCount(model);
  if (count <= 1 || index < 0 || index >= count) return;
  const pages = allPages(model);
  const [removed] = pages.splice(index, 1);
  setPages(model, pages);
  const placed = placedIds(model);
  const first = pageShapes(model, 0);
  for (const [id, shape] of Object.entries(removed.shapes)) {
    if (!placed.has(id)) first[id] = { ...shape, hidden: true };
  }
}

/** Moves a page to another position; whichever page ends up first becomes `diagram`. */
export function movePage(model: OrmModel, from: number, to: number): void {
  const count = pageCount(model);
  if (from < 0 || from >= count || to < 0 || to >= count || from === to) return;
  const pages = allPages(model);
  const [page] = pages.splice(from, 1);
  pages.splice(to, 0, page);
  setPages(model, pages);
}

function allPages(model: OrmModel): DiagramPage[] {
  const { pages, ...first } = model.diagram;
  return [first, ...(pages ?? [])];
}

function setPages(model: OrmModel, pages: DiagramPage[]): void {
  const [first, ...rest] = pages;
  model.diagram = rest.length ? { ...first, pages: rest } : { ...first };
}

/** Draws an element on a page, at `shape` or where it is drawn elsewhere. */
export function placeOnPage(model: OrmModel, index: number, id: Id, shape?: Shape): void {
  const key = shapeIdOf(model, id);
  const shapes = pageShapes(model, index);
  shapes[key] = withoutHidden(shape ?? shapes[key] ?? firstShape(model, key) ?? { x: 60, y: 60 });
  // Placing an element that was kept off the diagram removes that marker.
  const first = pageShapes(model, 0);
  if (index !== 0 && first[key]?.hidden) delete first[key];
}

/**
 * Takes an element off a page without deleting it from the model. When that
 * was its last placement it gets a hidden shape on the first page, so it stays
 * off the diagram instead of falling back onto the first page.
 */
export function removeFromPage(model: OrmModel, index: number, id: Id): void {
  const key = shapeIdOf(model, id);
  const shapes = pageShapes(model, index);
  const shape = shapes[key] ?? firstShape(model, key) ?? { x: 60, y: 60 };
  delete shapes[key];
  if (placedIds(model).has(key) && pagesOf(model, key).length) return;
  pageShapes(model, 0)[key] = { ...shape, hidden: true };
}

/** Removes an element's shape from every page. */
export function deleteShapes(model: OrmModel, id: Id): void {
  for (let index = 0; index < pageCount(model); index += 1) delete pageShapes(model, index)[id];
}

function firstShape(model: OrmModel, id: Id): Shape | undefined {
  for (let index = 0; index < pageCount(model); index += 1) {
    const shape = pageShapes(model, index)[id];
    if (shape) return shape;
  }
  return undefined;
}

function withoutHidden(shape: Shape): Shape {
  const { hidden: _hidden, ...rest } = shape;
  return rest;
}
