import {
  Constraint,
  FactType,
  Id,
  ObjectType,
  OrmModel,
  ValueRange,
} from '../model/types.js';
import { indexModel, predicateText, primaryReading } from '../model/model.js';
import {
  CONSTRAINT_R,
  Point,
  Rect,
  borderPoint,
  center,
  centroid,
  factTypeRect,
  objectTypeRect,
  roleRect,
  shapeOf,
  textWidth,
} from './geometry.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export interface RenderOptions {
  selection: Set<Id>;
  /** Roles highlighted for constraint creation. */
  selectedRoles: Set<Id>;
  showGrid: boolean;
  gridSize: number;
  /** Elements with an error or warning, for red/amber highlighting. */
  problems: Map<Id, 'error' | 'warning'>;
  /** Live connector preview while dragging a role onto an object type. */
  pending?: { from: Point; to: Point };
}

export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | undefined> = {},
  children: (Node | string)[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/* -------------------------------------------------------------------------- */
/* Diagram                                                                     */
/* -------------------------------------------------------------------------- */

export function renderDiagram(model: OrmModel, options: RenderOptions): SVGGElement {
  const root = el('g', { class: 'diagram-root' });
  const index = indexModel(model);

  const connectors = el('g', { class: 'layer-connectors' });
  const shapes = el('g', { class: 'layer-shapes' });
  const constraints = el('g', { class: 'layer-constraints' });
  const overlays = el('g', { class: 'layer-overlays' });

  for (const ft of model.factTypes) {
    renderRoleConnectors(model, ft, connectors);
  }
  for (const relation of model.subtypeRelations) {
    const sub = index.objectTypes.get(relation.subtypeId);
    const sup = index.objectTypes.get(relation.supertypeId);
    if (!sub || !sup) continue;
    connectors.append(renderSubtypeLink(model, relation.id, sub, sup, options));
  }

  for (const ft of model.factTypes) {
    shapes.append(renderFactType(model, ft, options));
  }
  for (const ot of model.objectTypes) {
    shapes.append(renderObjectType(model, ot, options));
  }

  renderInternalConstraints(model, constraints, options);
  renderExternalConstraints(model, constraints, options);
  renderValueConstraints(model, constraints);

  if (options.pending) {
    overlays.append(
      el('line', {
        class: 'pending-connector',
        x1: options.pending.from.x,
        y1: options.pending.from.y,
        x2: options.pending.to.x,
        y2: options.pending.to.y,
      }),
    );
  }

  root.append(connectors, shapes, constraints, overlays);
  return root;
}

/* -------------------------------------------------------------------------- */
/* Object types                                                                */
/* -------------------------------------------------------------------------- */

function renderObjectType(model: OrmModel, ot: ObjectType, options: RenderOptions): SVGGElement {
  const rect = objectTypeRect(model, ot);
  const selected = options.selection.has(ot.id);
  const problem = options.problems.get(ot.id);
  const group = el('g', {
    class: `shape object-type${selected ? ' selected' : ''}${problem ? ` has-${problem}` : ''}`,
    'data-kind': 'objectType',
    'data-id': ot.id,
    transform: `translate(${rect.x}, ${rect.y})`,
  });

  const objectifies = !!ot.objectifiedFactTypeId && model.factTypes.some((f) => f.id === ot.objectifiedFactTypeId);
  group.append(
    el('rect', {
      class: `ot-box ${objectifies ? 'objectified' : ot.kind === 'value' ? 'value-type' : 'entity-type'}`,
      x: 0,
      y: 0,
      width: rect.w,
      height: rect.h,
      rx: objectifies ? 12 : 10,
      ry: objectifies ? 12 : 10,
    }),
  );

  const objectified = !!ot.objectifiedFactTypeId && model.factTypes.some((ft) => ft.id === ot.objectifiedFactTypeId);
  if (objectified) {
    // The frame is the shape; its name sits above it so the roles stay legible.
    group.append(
      el('text', { class: 'objectification-name', x: rect.w / 2, y: -7, 'text-anchor': 'middle' }, [
        `"${ot.name}${ot.isIndependent ? ' !' : ''}"`,
      ]),
    );
    return group;
  }

  const hasRef = ot.kind === 'entity' && !!ot.refMode;
  const nameY = hasRef ? rect.h / 2 - 3 : rect.h / 2 + 4;
  group.append(
    el('text', { class: 'ot-name', x: rect.w / 2, y: nameY, 'text-anchor': 'middle' }, [
      `${ot.name}${ot.isIndependent ? ' !' : ''}`,
    ]),
  );
  if (hasRef) {
    group.append(
      el('text', { class: 'ot-refmode', x: rect.w / 2, y: rect.h / 2 + 13, 'text-anchor': 'middle' }, [
        `(.${ot.refMode})`,
      ]),
    );
  }
  if (ot.objectifiedFactTypeId) {
    group.append(el('title', {}, [`${ot.name} objectifies a fact type`]));
  }
  return group;
}

/* -------------------------------------------------------------------------- */
/* Fact types                                                                  */
/* -------------------------------------------------------------------------- */

function renderFactType(model: OrmModel, ft: FactType, options: RenderOptions): SVGGElement {
  const rect = factTypeRect(model, ft);
  const selected = options.selection.has(ft.id);
  const problem = options.problems.get(ft.id);
  const group = el('g', {
    class: `shape fact-type${selected ? ' selected' : ''}${problem ? ` has-${problem}` : ''}`,
    'data-kind': 'factType',
    'data-id': ft.id,
  });

  ft.roles.forEach((role, position) => {
    const box = roleRect(model, ft, position);
    const roleSelected = options.selectedRoles.has(role.id);
    group.append(
      el('rect', {
        class: `role-box${roleSelected ? ' role-selected' : ''}${role.objectTypeId ? '' : ' unattached'}`,
        'data-kind': 'role',
        'data-id': role.id,
        'data-fact-type': ft.id,
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
      }),
    );
    if (role.name) {
      group.append(
        el('text', { class: 'role-name', x: box.x + box.w / 2, y: box.y - 8, 'text-anchor': 'middle' }, [role.name]),
      );
    }
  });

  const reading = primaryReading(ft);
  if (reading) {
    const label = ft.roles.length <= 2 ? predicateText(reading) : readingLabel(reading.text);
    const vertical = shapeOf(model, ft.id).orientation === 'vertical';
    group.append(
      el(
        'text',
        {
          class: 'reading',
          x: vertical ? rect.x + rect.w + 8 : rect.x + rect.w / 2,
          y: vertical ? rect.y + rect.h / 2 : rect.y + rect.h + 14,
          'text-anchor': vertical ? 'start' : 'middle',
        },
        [label],
      ),
    );
  }
  if (ft.isDerived) {
    group.append(
      el('text', { class: 'derivation-mark', x: rect.x - 8, y: rect.y + rect.h + 14 }, [ft.isStored ? '**' : '*']),
    );
  }
  return group;
}

function readingLabel(text: string): string {
  return text.replace(/\{\d+\}/g, '…').replace(/\s+/g, ' ').trim();
}

function renderRoleConnectors(model: OrmModel, ft: FactType, layer: SVGGElement): void {
  ft.roles.forEach((role, position) => {
    if (!role.objectTypeId) return;
    const ot = model.objectTypes.find((o) => o.id === role.objectTypeId);
    if (!ot) return;
    const box = roleRect(model, ft, position);
    const otRect = objectTypeRect(model, ot);
    const from = center(box);
    const to = borderPoint(otRect, from);
    const start = borderPoint(box, to);
    layer.append(
      el('line', {
        class: 'role-connector',
        'data-kind': 'connector',
        'data-id': role.id,
        x1: start.x,
        y1: start.y,
        x2: to.x,
        y2: to.y,
      }),
    );

    if (isSimpleMandatory(model, role.id)) {
      layer.append(el('circle', { class: 'mandatory-dot', cx: to.x, cy: to.y, r: 4.5 }));
    }
  });
}

function isSimpleMandatory(model: OrmModel, roleId: Id): boolean {
  return model.constraints.some((c) => c.kind === 'mandatory' && c.roles.length === 1 && c.roles[0] === roleId);
}

function renderSubtypeLink(
  model: OrmModel,
  id: Id,
  sub: ObjectType,
  sup: ObjectType,
  options: RenderOptions,
): SVGGElement {
  const subRect = objectTypeRect(model, sub);
  const supRect = objectTypeRect(model, sup);
  const from = borderPoint(subRect, center(supRect));
  const to = borderPoint(supRect, center(subRect));
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 9;
  const tip = to;
  const left = {
    x: tip.x - size * Math.cos(angle - Math.PI / 7),
    y: tip.y - size * Math.sin(angle - Math.PI / 7),
  };
  const right = {
    x: tip.x - size * Math.cos(angle + Math.PI / 7),
    y: tip.y - size * Math.sin(angle + Math.PI / 7),
  };
  const selected = options.selection.has(id);
  const problem = options.problems.get(id);
  const group = el('g', {
    class: `subtype-link${selected ? ' selected' : ''}${problem ? ` has-${problem}` : ''}`,
    'data-kind': 'subtype',
    'data-id': id,
  });
  group.append(
    el('line', { class: 'subtype-line', x1: from.x, y1: from.y, x2: tip.x, y2: tip.y }),
    el('polygon', {
      class: 'subtype-arrow',
      points: `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`,
    }),
  );
  return group;
}

/* -------------------------------------------------------------------------- */
/* Internal constraints                                                        */
/* -------------------------------------------------------------------------- */

function renderInternalConstraints(model: OrmModel, layer: SVGGElement, options: RenderOptions): void {
  for (const ft of model.factTypes) {
    const roleIds = ft.roles.map((r) => r.id);
    const internal = model.constraints.filter(
      (c) =>
        (c.kind === 'uniqueness' || c.kind === 'frequency') &&
        c.roles.length > 0 &&
        c.roles.every((r) => roleIds.includes(r)),
    );
    // Stack overlapping bars so they stay readable.
    const levels: Constraint[][] = [];
    for (const constraint of internal) {
      const span = spanOf(constraint, roleIds);
      let level = 0;
      while (
        levels[level]?.some((other) => overlaps(span, spanOf(other, roleIds)))
      ) {
        level += 1;
      }
      levels[level] = [...(levels[level] ?? []), constraint];
      layer.append(renderConstraintBar(model, ft, constraint, level, options));
    }
  }

  // Disjunctive mandatory constraints often span roles in different fact types,
  // so they are drawn once over the whole diagram rather than per fact type.
  const allRoleIds = new Set(model.factTypes.flatMap((ft) => ft.roles.map((r) => r.id)));
  for (const constraint of model.constraints) {
    if (constraint.kind !== 'mandatory' || constraint.roles.length < 2) continue;
    if (!constraint.roles.every((r) => allRoleIds.has(r))) continue;
    layer.append(renderDisjunctiveMandatory(model, constraint.id, constraint.roles, options));
  }
}

function spanOf(constraint: Constraint, roleIds: Id[]): [number, number] {
  const positions = (constraint as { roles?: Id[] }).roles?.map((r) => roleIds.indexOf(r)) ?? [];
  const valid = positions.filter((p) => p >= 0);
  if (!valid.length) return [0, 0];
  return [Math.min(...valid), Math.max(...valid)];
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

function renderConstraintBar(
  model: OrmModel,
  ft: FactType,
  constraint: Constraint,
  level: number,
  options: RenderOptions,
): SVGGElement {
  const vertical = shapeOf(model, ft.id).orientation === 'vertical';
  const positions = ft.roles
    .map((role, position) => ({ role, position }))
    .filter(({ role }) => (constraint as { roles: Id[] }).roles.includes(role.id))
    .map(({ position }) => position);
  const selected = options.selection.has(constraint.id);
  const problem = options.problems.get(constraint.id);
  const isPreferred = constraint.kind === 'uniqueness' && !!constraint.isPreferredIdentifier;
  const group = el('g', {
    class: `constraint internal-constraint${selected ? ' selected' : ''}${problem ? ` has-${problem}` : ''}`,
    'data-kind': 'constraint',
    'data-id': constraint.id,
  });

  const offset = 6 + level * 6;
  const runs = contiguousRuns(positions);
  const gapRun: [number, number][] = [];
  for (let i = 1; i < runs.length; i += 1) gapRun.push([runs[i - 1][1], runs[i][0]]);

  const drawLine = (a: number, b: number, cls: string, shift = 0): void => {
    const first = roleRect(model, ft, a);
    const last = roleRect(model, ft, b);
    if (vertical) {
      const x = first.x - offset - shift;
      group.append(el('line', { class: cls, x1: x, y1: first.y + 1, x2: x, y2: last.y + last.h - 1 }));
    } else {
      const y = first.y - offset - shift;
      group.append(el('line', { class: cls, x1: first.x + 1, y1: y, x2: last.x + last.w - 1, y2: y }));
    }
  };

  for (const [from, to] of runs) {
    drawLine(from, to, constraint.kind === 'uniqueness' ? 'uniqueness-bar' : 'frequency-bar');
    if (isPreferred) drawLine(from, to, 'uniqueness-bar', 3);
  }
  for (const [from, to] of gapRun) drawLine(from, to, 'uniqueness-gap');

  if (constraint.kind === 'frequency') {
    const first = roleRect(model, ft, positions[0] ?? 0);
    const text = constraint.max === null ? `≥ ${constraint.min}` : constraint.min === constraint.max ? `${constraint.min}` : `${constraint.min}-${constraint.max}`;
    group.append(
      el(
        'text',
        {
          class: 'frequency-text',
          x: vertical ? first.x - offset - 6 : first.x - 4,
          y: vertical ? first.y - 2 : first.y - offset - 4,
          'text-anchor': 'end',
        },
        [text],
      ),
    );
  }
  return group;
}

function contiguousRuns(positions: number[]): [number, number][] {
  const sorted = [...positions].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const position of sorted) {
    const last = runs[runs.length - 1];
    if (last && position === last[1] + 1) last[1] = position;
    else runs.push([position, position]);
  }
  return runs;
}

function renderDisjunctiveMandatory(
  model: OrmModel,
  id: Id,
  roles: Id[],
  options: RenderOptions,
): SVGGElement {
  const rects = roleRectsFor(model, roles);
  const anchor = centroid(rects);
  const selected = options.selection.has(id);
  const group = el('g', {
    class: `constraint disjunctive-mandatory${selected ? ' selected' : ''}`,
    'data-kind': 'constraint',
    'data-id': id,
  });
  group.append(el('circle', { class: 'mandatory-dot', cx: anchor.x, cy: anchor.y, r: 5 }));
  for (const rect of rects) {
    const point = borderPoint(rect, anchor);
    group.append(
      el('line', { class: 'constraint-link', x1: anchor.x, y1: anchor.y, x2: point.x, y2: point.y }),
    );
  }
  return group;
}

/* -------------------------------------------------------------------------- */
/* External constraints                                                        */
/* -------------------------------------------------------------------------- */

function renderExternalConstraints(model: OrmModel, layer: SVGGElement, options: RenderOptions): void {
  const factRoleIds = new Set(model.factTypes.flatMap((ft) => ft.roles.map((r) => r.id)));
  for (const constraint of model.constraints) {
    const roles = externalRolesOf(constraint);
    if (!roles.length) continue;
    const owners = new Set(
      roles.map((roleId) => model.factTypes.find((ft) => ft.roles.some((r) => r.id === roleId))?.id),
    );
    const isExternal =
      constraint.kind === 'subset' ||
      constraint.kind === 'exclusion' ||
      constraint.kind === 'equality' ||
      constraint.kind === 'ring' ||
      (constraint.kind === 'uniqueness' && owners.size > 1);
    if (!isExternal) continue;
    if (!roles.every((r) => factRoleIds.has(r))) continue;
    layer.append(renderExternalConstraint(model, constraint, roles, options));
  }
}

function externalRolesOf(constraint: Constraint): Id[] {
  switch (constraint.kind) {
    case 'uniqueness':
      return constraint.roles;
    case 'ring':
      return [...constraint.roles];
    case 'subset':
    case 'exclusion':
    case 'equality':
      return constraint.roleSequences.flat();
    default:
      return [];
  }
}

function renderExternalConstraint(
  model: OrmModel,
  constraint: Constraint,
  roles: Id[],
  options: RenderOptions,
): SVGGElement {
  const rects = roleRectsFor(model, roles);
  const stored = model.diagram.shapes[constraint.id];
  const anchor = stored ? { x: stored.x, y: stored.y } : offsetCentroid(rects);
  const selected = options.selection.has(constraint.id);
  const problem = options.problems.get(constraint.id);
  const group = el('g', {
    class: `constraint external-constraint${selected ? ' selected' : ''}${problem ? ` has-${problem}` : ''}`,
    'data-kind': 'constraint',
    'data-id': constraint.id,
  });

  const arrowTargets = constraint.kind === 'subset' ? new Set(constraint.roleSequences[1] ?? []) : new Set<Id>();
  rects.forEach((rect, position) => {
    const point = borderPoint(rect, anchor);
    const line = el('line', {
      class: 'constraint-link',
      x1: anchor.x,
      y1: anchor.y,
      x2: point.x,
      y2: point.y,
    });
    group.append(line);
    if (arrowTargets.has(roles[position])) {
      group.append(arrowHead(anchor, point));
    }
  });

  group.append(el('circle', { class: 'constraint-circle', cx: anchor.x, cy: anchor.y, r: CONSTRAINT_R }));
  if (constraint.kind === 'uniqueness' && constraint.isPreferredIdentifier) {
    group.append(el('circle', { class: 'constraint-circle', cx: anchor.x, cy: anchor.y, r: CONSTRAINT_R - 3 }));
  }
  group.append(
    el('text', { class: 'constraint-glyph', x: anchor.x, y: anchor.y + 4, 'text-anchor': 'middle' }, [
      constraintGlyph(constraint),
    ]),
  );
  group.append(el('title', {}, [constraintTooltip(constraint)]));
  return group;
}

function arrowHead(from: Point, to: Point): SVGPolygonElement {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 7;
  const left = { x: to.x - size * Math.cos(angle - Math.PI / 7), y: to.y - size * Math.sin(angle - Math.PI / 7) };
  const right = { x: to.x - size * Math.cos(angle + Math.PI / 7), y: to.y - size * Math.sin(angle + Math.PI / 7) };
  return el('polygon', {
    class: 'constraint-arrow',
    points: `${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`,
  });
}

function constraintGlyph(constraint: Constraint): string {
  switch (constraint.kind) {
    case 'uniqueness':
      return '⎯';
    case 'subset':
      return '⊆';
    case 'exclusion':
      return '✕';
    case 'equality':
      return '=';
    case 'ring':
      return ringGlyph(constraint.types[0]);
    default:
      return '•';
  }
}

function ringGlyph(type: string | undefined): string {
  switch (type) {
    case 'irreflexive':
      return '↺';
    case 'symmetric':
      return '↔';
    case 'asymmetric':
      return '→';
    case 'antisymmetric':
      return '⇸';
    case 'transitive':
      return '↠';
    case 'intransitive':
      return '↛';
    case 'acyclic':
      return '⊘';
    default:
      return '○';
  }
}

function constraintTooltip(constraint: Constraint): string {
  if (constraint.kind === 'ring') return `Ring constraint: ${constraint.types.join(', ')}`;
  if (constraint.kind === 'uniqueness') {
    return constraint.isPreferredIdentifier ? 'External preferred identifier' : 'External uniqueness constraint';
  }
  return `${constraint.kind} constraint`;
}

function renderValueConstraints(model: OrmModel, layer: SVGGElement): void {
  for (const constraint of model.constraints) {
    if (constraint.kind !== 'value') continue;
    let anchor: Point | undefined;
    if (constraint.objectTypeId) {
      const ot = model.objectTypes.find((o) => o.id === constraint.objectTypeId);
      if (ot) {
        const rect = objectTypeRect(model, ot);
        anchor = { x: rect.x + rect.w / 2, y: rect.y + rect.h + 14 };
      }
    } else if (constraint.roleId) {
      const rect = roleRectsFor(model, [constraint.roleId])[0];
      if (rect) anchor = { x: rect.x + rect.w / 2, y: rect.y + rect.h + 26 };
    }
    if (!anchor) continue;
    const text = formatRanges(constraint.ranges);
    layer.append(
      el(
        'text',
        {
          class: 'value-constraint',
          'data-kind': 'constraint',
          'data-id': constraint.id,
          x: anchor.x,
          y: anchor.y,
          'text-anchor': 'middle',
        },
        [text],
      ),
    );
  }
}

export function formatRanges(ranges: ValueRange[]): string {
  const parts = ranges.map((range) => {
    if (range.value !== undefined) return typeof range.value === 'number' ? String(range.value) : `'${range.value}'`;
    const min = range.min !== undefined ? String(range.min) : '';
    const max = range.max !== undefined ? String(range.max) : '';
    return `${min}..${max}`;
  });
  return `{${parts.join(', ')}}`;
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

export function roleRectsFor(model: OrmModel, roleIds: Id[]): Rect[] {
  const rects: Rect[] = [];
  for (const roleId of roleIds) {
    for (const ft of model.factTypes) {
      const position = ft.roles.findIndex((r) => r.id === roleId);
      if (position >= 0) rects.push(roleRect(model, ft, position));
    }
  }
  return rects;
}

function offsetCentroid(rects: Rect[]): Point {
  const point = centroid(rects);
  return { x: point.x, y: point.y - 46 };
}

/** Bounding rectangle of everything drawn, used for zoom-to-fit and export. */
export function diagramBounds(model: OrmModel): Rect {
  const rects: Rect[] = [];
  for (const ot of model.objectTypes) rects.push(objectTypeRect(model, ot));
  for (const ft of model.factTypes) {
    const rect = factTypeRect(model, ft);
    const reading = primaryReading(ft);
    const labelWidth = reading ? textWidth(predicateText(reading)) : 0;
    rects.push({
      x: rect.x - 24,
      y: rect.y - 30,
      w: Math.max(rect.w, labelWidth) + 48,
      h: rect.h + 54,
    });
  }
  for (const [, shape] of Object.entries(model.diagram.shapes)) {
    rects.push({ x: shape.x - 20, y: shape.y - 20, w: (shape.w ?? 40) + 40, h: (shape.h ?? 40) + 40 });
  }
  if (!rects.length) return { x: 0, y: 0, w: 400, h: 300 };
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
