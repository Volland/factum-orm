import { Constraint, Id, OrmModel, Shape } from '../model/types.js';
import { deleteElement, newId } from '../model/model.js';
import { Issue } from '../core/validate.js';
import { HostMessage, WebviewMessage, WebviewSettings } from '../protocol.js';
import { autoLayout } from './autolayout.js';
import {
  Point,
  Rect,
  contains,
  factTypeRect,
  intersects,
  objectTypeRect,
  roleRect,
  shapeOf,
  snap,
} from './geometry.js';
import { SVG_NS, diagramBounds, el, renderDiagram } from './render.js';
import { PanelHost, PanelTab, renderPanel } from './panels.js';
import { h, clear } from './dom.js';
import { EXPORT_CSS } from './exportStyles.js';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

type Tool = 'select' | 'entity' | 'value' | 'fact1' | 'fact2' | 'fact3' | 'subtype' | 'connect';

interface View {
  scale: number;
  x: number;
  y: number;
}

interface DragState {
  kind: 'move' | 'pan' | 'marquee' | 'connect';
  origin: Point;
  last: Point;
  moved: boolean;
  /** Shape positions when the drag started, for a single undoable move. */
  startShapes?: Record<Id, Shape>;
  ids?: Id[];
  roleId?: Id;
}

const state = {
  model: {
    version: 1,
    name: 'Loading…',
    objectTypes: [],
    factTypes: [],
    subtypeRelations: [],
    constraints: [],
    diagram: { shapes: {} },
  } as OrmModel,
  issues: [] as Issue[],
  settings: {
    snapToGrid: true,
    gridSize: 10,
    showGrid: true,
    verbalizationMode: 'forml',
    ddlDialect: 'postgres',
  } as WebviewSettings,
  editable: true,
  selection: new Set<Id>(),
  selectedRoles: new Set<Id>(),
  tool: 'select' as Tool,
  tab: 'properties' as PanelTab,
  view: { scale: 1, x: 0, y: 0 } as View,
  drag: undefined as DragState | undefined,
  pendingSubtype: undefined as Id | undefined,
  pointer: { x: 0, y: 0 } as Point,
};

/* -------------------------------------------------------------------------- */
/* Shell                                                                       */
/* -------------------------------------------------------------------------- */

const app = document.getElementById('app')!;
const toolbar = h('div', { class: 'toolbar' });
const svg = document.createElementNS(SVG_NS, 'svg');
svg.setAttribute('class', 'canvas');
const viewport = el('g', { class: 'viewport' });
const canvasWrap = h('div', { class: 'canvas-wrap' });
const panel = h('div', { class: 'panel' });
const panelBody = h('div', { class: 'panel-body' });
const tabs = h('div', { class: 'tabs' });
const status = h('div', { class: 'status-bar' });
const inlineEditor = h('input', { class: 'inline-editor', type: 'text' }) as HTMLInputElement;

function buildShell(): void {
  svg.append(defs(), viewport);
  canvasWrap.append(svg, inlineEditor, status);
  panel.append(tabs, panelBody);
  app.append(toolbar, canvasWrap, panel);
  inlineEditor.style.display = 'none';
  buildTabs();
}

function defs(): SVGDefsElement {
  const node = el('defs');
  const pattern = el('pattern', {
    id: 'grid',
    width: state.settings.gridSize * 2,
    height: state.settings.gridSize * 2,
    patternUnits: 'userSpaceOnUse',
  });
  pattern.append(
    el('circle', { class: 'grid-dot', cx: 0.5, cy: 0.5, r: 0.8 }),
  );
  node.append(pattern);
  return node;
}

function buildTabs(): void {
  const entries: [PanelTab, string][] = [
    ['properties', 'Properties'],
    ['verbalization', 'Verbalization'],
    ['relational', 'Relational'],
    ['graph', 'Graph'],
    ['problems', 'Problems'],
  ];
  clear(tabs);
  for (const [tab, label] of entries) {
    const count = tab === 'problems' && state.issues.length ? ` (${state.issues.length})` : '';
    tabs.append(
      h('button', {
        class: `tab${state.tab === tab ? ' active' : ''}`,
        text: `${label}${count}`,
        onclick: () => {
          state.tab = tab;
          buildTabs();
          renderSidePanel();
        },
      }),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                     */
/* -------------------------------------------------------------------------- */

interface ToolButton {
  id: string;
  label: string;
  title: string;
  onClick: () => void;
  isActive?: () => boolean;
  isEnabled?: () => boolean;
}

function buildToolbar(): void {
  clear(toolbar);
  const tools: [Tool, string, string][] = [
    ['select', '⬉', 'Select and move (V)'],
    ['entity', '▢', 'Add entity type (E)'],
    ['value', '▱', 'Add value type (T)'],
    ['fact1', '▬', 'Add unary fact type (1)'],
    ['fact2', '▬▬', 'Add binary fact type (2)'],
    ['fact3', '▬▬▬', 'Add ternary fact type (3)'],
    ['subtype', '△', 'Add subtype link (S)'],
    ['connect', '⤙', 'Connect a role to an object type (C)'],
  ];
  addGroup(
    tools.map(([tool, label, title]) => ({
      id: tool,
      label,
      title,
      onClick: () => setTool(tool),
      isActive: () => state.tool === tool,
    })),
  );

  addGroup([
    button('U', 'Uniqueness constraint over the selected roles', () => addUniqueness(false), hasRoles),
    button('P', 'Preferred identifier over the selected roles', () => addUniqueness(true), hasRoles),
    button('●', 'Mandatory constraint over the selected role(s)', addMandatory, hasRoles),
    button('n', 'Frequency constraint over the selected roles', addFrequency, hasRoles),
    button('↺', 'Ring constraint over two selected roles', addRing, () => state.selectedRoles.size === 2),
    button('⊆', 'Subset constraint (select subset roles, then superset roles)', () => addSetConstraint('subset'), hasTwoRoles),
    button('✕', 'Exclusion constraint', () => addSetConstraint('exclusion'), hasTwoRoles),
    button('=', 'Equality constraint', () => addSetConstraint('equality'), hasTwoRoles),
  ]);

  addGroup([
    button('＋', 'Zoom in', () => zoomBy(1.2)),
    button('－', 'Zoom out', () => zoomBy(1 / 1.2)),
    button('⤢', 'Zoom to fit (F)', zoomToFit),
    button('⚄', 'Auto-layout (Ctrl/Cmd+Alt+L)', applyAutoLayout),
    button('🖫', 'Export SVG', () => exportDiagram('svg')),
    button('{ }', 'Open the model source as JSON', () => post({ type: 'openJson' })),
  ]);

  const trash = button('🗑', 'Delete selection (Delete)', deleteSelection, () => state.selection.size > 0);
  addGroup([trash]);
}

function addGroup(buttons: ToolButton[]): void {
  const group = h('div', { class: 'tool-group' });
  for (const spec of buttons) {
    const enabled = spec.isEnabled ? spec.isEnabled() : true;
    group.append(
      h('button', {
        class: `tool-button${spec.isActive?.() ? ' active' : ''}`,
        title: spec.title,
        text: spec.label,
        disabled: !enabled || !state.editable,
        onclick: spec.onClick,
      }),
    );
  }
  toolbar.append(group);
}

function button(label: string, title: string, onClick: () => void, isEnabled?: () => boolean): ToolButton {
  return { id: label, label, title, onClick, isEnabled };
}

function hasRoles(): boolean {
  return state.selectedRoles.size > 0;
}

function hasTwoRoles(): boolean {
  return state.selectedRoles.size >= 2;
}

function setTool(tool: Tool): void {
  state.tool = tool;
  state.pendingSubtype = undefined;
  buildToolbar();
  svg.setAttribute('data-tool', tool);
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

function render(): void {
  renderCanvas();
  renderStatus();
  buildToolbar();
  renderSidePanel();
}

/** Redraws only the diagram; used on every drag frame, where the panel and
 * toolbar cannot have changed. */
function renderCanvas(): void {
  clear(viewport);
  const problems = new Map<Id, 'error' | 'warning'>();
  for (const issue of state.issues) {
    if (issue.severity === 'info') continue;
    const existing = problems.get(issue.elementId);
    if (existing === 'error') continue;
    problems.set(issue.elementId, issue.severity);
  }

  if (state.settings.showGrid) {
    viewport.append(
      el('rect', {
        class: 'grid-background',
        x: -5000,
        y: -5000,
        width: 20000,
        height: 20000,
        fill: 'url(#grid)',
      }),
    );
  }

  viewport.append(
    renderDiagram(state.model, {
      selection: state.selection,
      selectedRoles: state.selectedRoles,
      showGrid: state.settings.showGrid,
      gridSize: state.settings.gridSize,
      problems,
    }),
  );

  applyView();
}

function applyView(): void {
  viewport.setAttribute('transform', `translate(${state.view.x}, ${state.view.y}) scale(${state.view.scale})`);
}

function renderStatus(): void {
  const errors = state.issues.filter((i) => i.severity === 'error').length;
  const warnings = state.issues.filter((i) => i.severity === 'warning').length;
  clear(status);
  const parts: HTMLElement[] = [
    h('span', { text: `${state.model.objectTypes.length} object types · ${state.model.factTypes.length} fact types` }),
    h('span', {
      class: `status-problems${errors ? ' has-errors' : warnings ? ' has-warnings' : ''}`,
      text: errors || warnings ? `${errors} error(s), ${warnings} warning(s)` : 'No problems',
      onclick: () => {
        state.tab = 'problems';
        buildTabs();
        renderSidePanel();
      },
    }),
    h('span', { text: `${Math.round(state.view.scale * 100)}%` }),
  ];
  if (state.selectedRoles.size) {
    parts.push(h('span', { text: `${state.selectedRoles.size} role(s) selected` }));
  }
  status.append(...parts);
}

function renderSidePanel(): void {
  const host: PanelHost = {
    model: state.model,
    selection: state.selection,
    selectedRoles: state.selectedRoles,
    issues: state.issues,
    settings: state.settings,
    commit,
    select: (id, options) => {
      state.selection = new Set([id]);
      state.selectedRoles.clear();
      if (options?.reveal) revealElement(id);
      render();
    },
    notify: (level, message) => post({ type: 'notify', level, message }),
  };
  renderPanel(panelBody, state.tab, host);
}

/* -------------------------------------------------------------------------- */
/* Editing                                                                     */
/* -------------------------------------------------------------------------- */

function commit(label: string, mutate: (model: OrmModel) => void): void {
  if (!state.editable) {
    post({ type: 'notify', level: 'warning', message: 'This model is read-only.' });
    return;
  }
  const draft: OrmModel = structuredClone(state.model);
  mutate(draft);
  state.model = draft;
  post({ type: 'edit', model: draft, label });
  render();
}

function deleteSelection(): void {
  if (!state.selection.size) return;
  const ids = [...state.selection];
  commit('Delete', (model) => {
    for (const id of ids) deleteElement(model, id);
  });
  state.selection.clear();
  state.selectedRoles.clear();
  render();
}

function addUniqueness(preferred: boolean): void {
  const roles = [...state.selectedRoles];
  if (!roles.length) return;
  commit(preferred ? 'Add preferred identifier' : 'Add uniqueness constraint', (model) => {
    model.constraints.push({
      id: newId('uc'),
      kind: 'uniqueness',
      roles,
      isPreferredIdentifier: preferred || undefined,
    });
  });
}

function addMandatory(): void {
  const roles = [...state.selectedRoles];
  if (!roles.length) return;
  commit('Add mandatory constraint', (model) => {
    model.constraints.push({ id: newId('mc'), kind: 'mandatory', roles });
  });
}

function addFrequency(): void {
  const roles = [...state.selectedRoles];
  if (!roles.length) return;
  commit('Add frequency constraint', (model) => {
    model.constraints.push({ id: newId('fc'), kind: 'frequency', roles, min: 2, max: null });
  });
}

function addRing(): void {
  const roles = [...state.selectedRoles];
  if (roles.length !== 2) return;
  commit('Add ring constraint', (model) => {
    model.constraints.push({ id: newId('rc'), kind: 'ring', roles: [roles[0], roles[1]], types: ['irreflexive'] });
  });
}

/**
 * Set-comparison constraints need two role sequences. Roles selected from the
 * same fact type form one sequence, so selecting across two fact types gives
 * the usual two-sequence shape.
 */
function addSetConstraint(kind: 'subset' | 'exclusion' | 'equality'): void {
  const roles = [...state.selectedRoles];
  if (roles.length < 2) return;
  const sequences = new Map<string, Id[]>();
  for (const roleId of roles) {
    const ft = state.model.factTypes.find((f) => f.roles.some((r) => r.id === roleId));
    const key = ft?.id ?? roleId;
    sequences.set(key, [...(sequences.get(key) ?? []), roleId]);
  }
  const roleSequences = [...sequences.values()];
  if (roleSequences.length < 2) {
    post({
      type: 'notify',
      level: 'warning',
      message: `A ${kind} constraint compares roles from two different fact types. Select roles in both.`,
    });
    return;
  }
  commit(`Add ${kind} constraint`, (model) => {
    model.constraints.push({ id: newId('sc'), kind, roleSequences } as Constraint);
  });
}

function applyAutoLayout(): void {
  commit('Auto-layout', (model) => {
    const laid = autoLayout(model);
    model.diagram = laid.diagram;
  });
  zoomToFit();
}

/* -------------------------------------------------------------------------- */
/* Pointer interaction                                                         */
/* -------------------------------------------------------------------------- */

function toDiagram(event: PointerEvent | WheelEvent | MouseEvent): Point {
  const rect = svg.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.view.x) / state.view.scale,
    y: (event.clientY - rect.top - state.view.y) / state.view.scale,
  };
}

function hitTarget(event: PointerEvent): { kind: string; id: Id } | undefined {
  const target = (event.target as Element | null)?.closest('[data-kind]');
  if (!target) return undefined;
  const kind = target.getAttribute('data-kind');
  const id = target.getAttribute('data-id');
  if (!kind || !id) return undefined;
  return { kind, id };
}

svg.addEventListener('pointerdown', (event: PointerEvent) => {
  hideInlineEditor();
  const point = toDiagram(event);
  state.pointer = point;
  const hit = hitTarget(event);
  const additive = event.shiftKey || event.metaKey || event.ctrlKey;

  if (event.button === 1) {
    startDrag({ kind: 'pan', origin: point, last: point, moved: false });
    svg.setPointerCapture(event.pointerId);
    return;
  }

  switch (state.tool) {
    case 'entity':
    case 'value':
      createObjectType(point, state.tool === 'value' ? 'value' : 'entity');
      return;
    case 'fact1':
    case 'fact2':
    case 'fact3':
      createFactType(point, Number(state.tool.slice(4)));
      return;
    case 'subtype':
      if (hit?.kind === 'objectType') handleSubtypeClick(hit.id);
      return;
    case 'connect':
      if (hit?.kind === 'role') {
        startDrag({ kind: 'connect', origin: point, last: point, moved: false, roleId: hit.id });
        svg.setPointerCapture(event.pointerId);
      }
      return;
    default:
      break;
  }

  if (!hit) {
    if (!additive) {
      state.selection.clear();
      state.selectedRoles.clear();
    }
    startDrag({ kind: 'marquee', origin: point, last: point, moved: false });
    svg.setPointerCapture(event.pointerId);
    render();
    return;
  }

  if (hit.kind === 'role') {
    const ownerId = (event.target as Element).getAttribute('data-fact-type');
    if (!additive) state.selectedRoles.clear();
    if (state.selectedRoles.has(hit.id) && additive) state.selectedRoles.delete(hit.id);
    else state.selectedRoles.add(hit.id);
    state.selection = new Set(ownerId ? [ownerId] : []);
    if (ownerId) {
      startDrag({
        kind: 'move',
        origin: point,
        last: point,
        moved: false,
        ids: [ownerId],
        startShapes: structuredClone(state.model.diagram.shapes),
      });
      svg.setPointerCapture(event.pointerId);
    }
    render();
    return;
  }

  if (!additive && !state.selection.has(hit.id)) {
    state.selection = new Set([hit.id]);
    state.selectedRoles.clear();
  } else if (additive) {
    if (state.selection.has(hit.id)) state.selection.delete(hit.id);
    else state.selection.add(hit.id);
  }

  startDrag({
    kind: 'move',
    origin: point,
    last: point,
    moved: false,
    ids: [...state.selection],
    startShapes: structuredClone(state.model.diagram.shapes),
  });
  svg.setPointerCapture(event.pointerId);
  render();
});

svg.addEventListener('pointermove', (event: PointerEvent) => {
  const point = toDiagram(event);
  state.pointer = point;
  const drag = state.drag;
  if (!drag) return;
  const dx = point.x - drag.last.x;
  const dy = point.y - drag.last.y;
  if (Math.abs(point.x - drag.origin.x) > 2 || Math.abs(point.y - drag.origin.y) > 2) drag.moved = true;

  switch (drag.kind) {
    case 'pan':
      state.view.x += dx * state.view.scale;
      state.view.y += dy * state.view.scale;
      applyView();
      renderStatus();
      break;
    case 'move': {
      if (!drag.ids?.length || !state.editable) break;
      const totalX = point.x - drag.origin.x;
      const totalY = point.y - drag.origin.y;
      for (const id of drag.ids) {
        const start = drag.startShapes?.[id] ?? shapeOf(state.model, id);
        state.model.diagram.shapes[id] = {
          ...start,
          x: snap(start.x + totalX, state.settings.gridSize, state.settings.snapToGrid),
          y: snap(start.y + totalY, state.settings.gridSize, state.settings.snapToGrid),
        };
      }
      renderCanvas();
      break;
    }
    case 'marquee':
      drawMarquee(drag.origin, point);
      break;
    case 'connect':
      drawPendingConnector(drag.roleId!, point);
      break;
  }
  drag.last = point;
});

svg.addEventListener('pointerup', (event: PointerEvent) => {
  const drag = state.drag;
  const point = toDiagram(event);
  state.drag = undefined;
  clearOverlay();
  if (!drag) return;
  svg.releasePointerCapture?.(event.pointerId);

  if (drag.kind === 'move' && drag.moved && drag.ids?.length && state.editable) {
    const moved = structuredClone(state.model.diagram.shapes);
    const before = drag.startShapes;
    state.model.diagram.shapes = before ?? moved;
    commit('Move shapes', (model) => {
      model.diagram.shapes = moved;
    });
    return;
  }

  if (drag.kind === 'marquee' && drag.moved) {
    selectWithin(rectFromPoints(drag.origin, point));
    render();
    return;
  }

  if (drag.kind === 'connect' && drag.roleId) {
    const hit = hitTarget(event);
    if (hit?.kind === 'objectType') {
      const roleId = drag.roleId;
      const objectTypeId = hit.id;
      commit('Connect role', (model) => {
        for (const ft of model.factTypes) {
          const role = ft.roles.find((r) => r.id === roleId);
          if (role) role.objectTypeId = objectTypeId;
        }
      });
    }
    setTool('select');
  }
});

svg.addEventListener('dblclick', (event: MouseEvent) => {
  const target = (event.target as Element | null)?.closest('[data-kind]');
  if (!target) return;
  const kind = target.getAttribute('data-kind');
  const id = target.getAttribute('data-id');
  if (!id) return;
  if (kind === 'objectType') startInlineEdit(id, 'objectType');
  else if (kind === 'factType' || kind === 'role') {
    const factTypeId = kind === 'role' ? target.getAttribute('data-fact-type') : id;
    if (factTypeId) startInlineEdit(factTypeId, 'factType');
  }
});

svg.addEventListener(
  'wheel',
  (event: WheelEvent) => {
    event.preventDefault();
    if (event.shiftKey) {
      state.view.x -= event.deltaY;
      applyView();
      return;
    }
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAround(toDiagram(event), factor);
  },
  { passive: false },
);

function startDrag(drag: DragState): void {
  state.drag = drag;
}

let overlay: SVGElement | undefined;

function clearOverlay(): void {
  overlay?.remove();
  overlay = undefined;
}

function drawMarquee(from: Point, to: Point): void {
  clearOverlay();
  const rect = rectFromPoints(from, to);
  overlay = el('rect', { class: 'marquee', x: rect.x, y: rect.y, width: rect.w, height: rect.h });
  viewport.append(overlay);
}

function drawPendingConnector(roleId: Id, to: Point): void {
  clearOverlay();
  const location = roleLocation(roleId);
  if (!location) return;
  overlay = el('line', {
    class: 'pending-connector',
    x1: location.x,
    y1: location.y,
    x2: to.x,
    y2: to.y,
  });
  viewport.append(overlay);
}

function roleLocation(roleId: Id): Point | undefined {
  for (const ft of state.model.factTypes) {
    const position = ft.roles.findIndex((r) => r.id === roleId);
    if (position < 0) continue;
    const rect = roleRect(state.model, ft, position);
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }
  return undefined;
}

function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function selectWithin(area: Rect): void {
  state.selection.clear();
  state.selectedRoles.clear();
  for (const ot of state.model.objectTypes) {
    if (intersects(area, objectTypeRect(state.model, ot))) state.selection.add(ot.id);
  }
  for (const ft of state.model.factTypes) {
    if (intersects(area, factTypeRect(state.model, ft))) state.selection.add(ft.id);
  }
}

/* -------------------------------------------------------------------------- */
/* Element creation                                                            */
/* -------------------------------------------------------------------------- */

function createObjectType(point: Point, kind: 'entity' | 'value'): void {
  const id = newId('ot');
  const base = kind === 'entity' ? 'EntityType' : 'ValueType';
  commit(`Add ${kind} type`, (model) => {
    let name = base;
    let suffix = 1;
    while (model.objectTypes.some((o) => o.name === name)) {
      suffix += 1;
      name = `${base}${suffix}`;
    }
    model.objectTypes.push({
      id,
      name,
      kind,
      refMode: kind === 'entity' ? 'id' : undefined,
      dataType: kind === 'value' ? 'string' : 'integer',
    });
    model.diagram.shapes[id] = {
      x: snap(point.x - 40, state.settings.gridSize, state.settings.snapToGrid),
      y: snap(point.y - 17, state.settings.gridSize, state.settings.snapToGrid),
    };
  });
  state.selection = new Set([id]);
  setTool('select');
  render();
  startInlineEdit(id, 'objectType');
}

function createFactType(point: Point, arity: number): void {
  const id = newId('ft');
  commit(`Add ${arity}-ary fact type`, (model) => {
    const roles = Array.from({ length: arity }, () => ({ id: newId('r'), objectTypeId: null }));
    const text = roles.map((_, position) => `{${position}}`).join(' ... ');
    model.factTypes.push({
      id,
      roles,
      readings: [{ id: newId('rd'), roleOrder: roles.map((r) => r.id), text, isPrimary: true }],
    });
    model.diagram.shapes[id] = {
      x: snap(point.x - 26, state.settings.gridSize, state.settings.snapToGrid),
      y: snap(point.y - 9, state.settings.gridSize, state.settings.snapToGrid),
      orientation: 'horizontal',
    };
    // A fresh fact type gets the uniqueness pattern most models start from.
    model.constraints.push({
      id: newId('uc'),
      kind: 'uniqueness',
      roles: arity === 1 ? [roles[0].id] : roles.slice(0, arity - 1).map((r) => r.id),
    });
  });
  state.selection = new Set([id]);
  setTool('select');
  render();
}

function handleSubtypeClick(objectTypeId: Id): void {
  if (!state.pendingSubtype) {
    state.pendingSubtype = objectTypeId;
    post({ type: 'notify', level: 'info', message: 'Now click the supertype.' });
    return;
  }
  const subtypeId = state.pendingSubtype;
  state.pendingSubtype = undefined;
  if (subtypeId === objectTypeId) {
    setTool('select');
    return;
  }
  commit('Add subtype link', (model) => {
    model.subtypeRelations.push({ id: newId('st'), subtypeId, supertypeId: objectTypeId });
  });
  setTool('select');
}

/* -------------------------------------------------------------------------- */
/* Inline editing                                                              */
/* -------------------------------------------------------------------------- */

let inlineTarget: { id: Id; kind: 'objectType' | 'factType' } | undefined;

function startInlineEdit(id: Id, kind: 'objectType' | 'factType'): void {
  if (!state.editable) return;
  const rect = screenRectOf(id, kind);
  if (!rect) return;
  inlineTarget = { id, kind };
  const model = state.model;
  const value =
    kind === 'objectType'
      ? model.objectTypes.find((o) => o.id === id)?.name ?? ''
      : model.factTypes.find((f) => f.id === id)?.readings[0]?.text ?? '';
  inlineEditor.value = value;
  inlineEditor.style.display = 'block';
  inlineEditor.style.left = `${rect.x}px`;
  inlineEditor.style.top = `${rect.y}px`;
  inlineEditor.style.width = `${Math.max(rect.w, 120)}px`;
  inlineEditor.focus();
  inlineEditor.select();
}

function hideInlineEditor(): void {
  if (!inlineTarget) return;
  inlineEditor.style.display = 'none';
  inlineTarget = undefined;
}

function commitInlineEdit(): void {
  if (!inlineTarget) return;
  const { id, kind } = inlineTarget;
  const value = inlineEditor.value.trim();
  hideInlineEditor();
  if (!value) return;
  commit(kind === 'objectType' ? 'Rename object type' : 'Edit reading', (model) => {
    if (kind === 'objectType') {
      const ot = model.objectTypes.find((o) => o.id === id);
      if (ot) {
        // "Person(.nr)" or "Person (.nr)" sets name and reference mode at once.
        const match = value.match(/^(.*?)\s*\(\.?(.*?)\)$/);
        if (match) {
          ot.name = match[1].trim();
          ot.refMode = match[2].trim() || undefined;
        } else {
          ot.name = value;
        }
      }
    } else {
      const ft = model.factTypes.find((f) => f.id === id);
      const reading = ft?.readings[0];
      if (reading) reading.text = value;
    }
  });
}

inlineEditor.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitInlineEdit();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    hideInlineEditor();
  }
  event.stopPropagation();
});
inlineEditor.addEventListener('blur', commitInlineEdit);

function screenRectOf(id: Id, kind: 'objectType' | 'factType'): Rect | undefined {
  const model = state.model;
  let rect: Rect | undefined;
  if (kind === 'objectType') {
    const ot = model.objectTypes.find((o) => o.id === id);
    if (ot) rect = objectTypeRect(model, ot);
  } else {
    const ft = model.factTypes.find((f) => f.id === id);
    if (ft) {
      const base = factTypeRect(model, ft);
      rect = { x: base.x, y: base.y + base.h + 4, w: Math.max(base.w, 140), h: 20 };
    }
  }
  if (!rect) return undefined;
  return {
    x: rect.x * state.view.scale + state.view.x,
    y: rect.y * state.view.scale + state.view.y,
    w: rect.w * state.view.scale,
    h: rect.h * state.view.scale,
  };
}

/* -------------------------------------------------------------------------- */
/* View                                                                        */
/* -------------------------------------------------------------------------- */

function zoomBy(factor: number): void {
  const rect = svg.getBoundingClientRect();
  zoomAround(
    {
      x: (rect.width / 2 - state.view.x) / state.view.scale,
      y: (rect.height / 2 - state.view.y) / state.view.scale,
    },
    factor,
  );
}

function zoomAround(point: Point, factor: number): void {
  const next = Math.min(4, Math.max(0.15, state.view.scale * factor));
  state.view.x += point.x * state.view.scale - point.x * next;
  state.view.y += point.y * state.view.scale - point.y * next;
  state.view.scale = next;
  applyView();
  renderStatus();
}

function zoomToFit(): void {
  const bounds = diagramBounds(state.model);
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scale = Math.min(2, Math.max(0.15, Math.min(rect.width / (bounds.w + 80), rect.height / (bounds.h + 80))));
  state.view.scale = scale;
  state.view.x = (rect.width - bounds.w * scale) / 2 - bounds.x * scale;
  state.view.y = (rect.height - bounds.h * scale) / 2 - bounds.y * scale;
  applyView();
  renderStatus();
}

function revealElement(id: Id): void {
  const model = state.model;
  let rect: Rect | undefined;
  const ot = model.objectTypes.find((o) => o.id === id);
  if (ot) rect = objectTypeRect(model, ot);
  const ft = model.factTypes.find((f) => f.id === id);
  if (ft) rect = factTypeRect(model, ft);
  const shape = model.diagram.shapes[id];
  if (!rect && shape) rect = { x: shape.x, y: shape.y, w: shape.w ?? 40, h: shape.h ?? 40 };
  if (!rect) {
    // Constraints without their own shape: centre on the roles they constrain.
    const constraint = model.constraints.find((c) => c.id === id);
    if (constraint) {
      const roleIds =
        constraint.kind === 'subset' || constraint.kind === 'exclusion' || constraint.kind === 'equality'
          ? constraint.roleSequences.flat()
          : (constraint as { roles?: Id[] }).roles ?? [];
      const location = roleIds.map(roleLocation).find(Boolean);
      if (location) rect = { x: location.x - 20, y: location.y - 20, w: 40, h: 40 };
    }
  }
  if (!rect) return;
  const view = svg.getBoundingClientRect();
  const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  const visible = {
    x: (0 - state.view.x) / state.view.scale,
    y: (0 - state.view.y) / state.view.scale,
    w: view.width / state.view.scale,
    h: view.height / state.view.scale,
  };
  if (contains(visible, center)) return;
  state.view.x = view.width / 2 - center.x * state.view.scale;
  state.view.y = view.height / 2 - center.y * state.view.scale;
  applyView();
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

function buildExportSvg(): string {
  const bounds = diagramBounds(state.model);
  const margin = 24;
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('xmlns', SVG_NS);
  root.setAttribute('width', String(Math.ceil(bounds.w + margin * 2)));
  root.setAttribute('height', String(Math.ceil(bounds.h + margin * 2)));
  root.setAttribute(
    'viewBox',
    `${bounds.x - margin} ${bounds.y - margin} ${bounds.w + margin * 2} ${bounds.h + margin * 2}`,
  );
  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = EXPORT_CSS;
  root.append(style);
  root.append(
    el('rect', {
      x: bounds.x - margin,
      y: bounds.y - margin,
      width: bounds.w + margin * 2,
      height: bounds.h + margin * 2,
      fill: '#ffffff',
    }),
  );
  root.append(
    renderDiagram(state.model, {
      selection: new Set(),
      selectedRoles: new Set(),
      showGrid: false,
      gridSize: state.settings.gridSize,
      problems: new Map(),
    }),
  );
  return new XMLSerializer().serializeToString(root);
}

async function exportDiagram(format: 'svg' | 'png'): Promise<void> {
  const svgText = buildExportSvg();
  if (format === 'svg') {
    post({ type: 'export', format, data: svgText });
    return;
  }
  try {
    const png = await rasterize(svgText);
    post({ type: 'export', format, data: png });
  } catch (error) {
    post({ type: 'notify', level: 'error', message: `PNG export failed: ${(error as Error).message}` });
  }
}

function rasterize(svgText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bounds = diagramBounds(state.model);
    const scale = 2;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil((bounds.w + 48) * scale);
      canvas.height = Math.ceil((bounds.h + 48) * scale);
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('no 2d context'));
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png').split(',')[1] ?? '');
    };
    image.onerror = () => reject(new Error('could not rasterize the diagram'));
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
  });
}

/* -------------------------------------------------------------------------- */
/* Keyboard                                                                    */
/* -------------------------------------------------------------------------- */

window.addEventListener('keydown', (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    post({ type: event.shiftKey ? 'redo' : 'undo' });
    return;
  }
  if (meta) return;

  switch (event.key) {
    case 'Delete':
    case 'Backspace':
      event.preventDefault();
      deleteSelection();
      break;
    case 'Escape':
      state.selection.clear();
      state.selectedRoles.clear();
      state.pendingSubtype = undefined;
      setTool('select');
      render();
      break;
    case 'v':
    case 'V':
      setTool('select');
      break;
    case 'e':
    case 'E':
      setTool('entity');
      break;
    case 't':
    case 'T':
      setTool('value');
      break;
    case '1':
      setTool('fact1');
      break;
    case '2':
      setTool('fact2');
      break;
    case '3':
      setTool('fact3');
      break;
    case 's':
    case 'S':
      setTool('subtype');
      break;
    case 'c':
    case 'C':
      setTool('connect');
      break;
    case 'f':
    case 'F':
      zoomToFit();
      break;
    default:
      break;
  }
});

/* -------------------------------------------------------------------------- */
/* Host messages                                                               */
/* -------------------------------------------------------------------------- */

function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      state.model = message.model;
      state.issues = message.issues;
      state.settings = message.settings;
      state.editable = message.editable;
      buildTabs();
      render();
      zoomToFit();
      break;
    case 'update':
      state.model = message.model;
      state.issues = message.issues;
      pruneSelection();
      buildTabs();
      render();
      break;
    case 'settings':
      state.settings = message.settings;
      render();
      break;
    case 'command':
      if (message.name === 'autoLayout') applyAutoLayout();
      else if (message.name === 'exportSvg') void exportDiagram('svg');
      else if (message.name === 'exportPng') void exportDiagram('png');
      else if (message.name === 'zoomToFit') zoomToFit();
      break;
    case 'parseError':
      showParseError(message.message);
      break;
  }
});

function pruneSelection(): void {
  const ids = new Set<Id>([
    ...state.model.objectTypes.map((o) => o.id),
    ...state.model.factTypes.map((f) => f.id),
    ...state.model.constraints.map((c) => c.id),
    ...state.model.subtypeRelations.map((s) => s.id),
  ]);
  for (const id of [...state.selection]) if (!ids.has(id)) state.selection.delete(id);
  const roleIds = new Set(state.model.factTypes.flatMap((f) => f.roles.map((r) => r.id)));
  for (const id of [...state.selectedRoles]) if (!roleIds.has(id)) state.selectedRoles.delete(id);
}

function showParseError(message: string): void {
  clear(panelBody);
  panelBody.append(
    h('div', { class: 'parse-error' }, [
      h('h2', { text: 'This file could not be read as an ORM model' }),
      h('p', { text: message }),
      h('button', { text: 'Open the file as text', onclick: () => post({ type: 'openJson' }) }),
    ]),
  );
}

/* -------------------------------------------------------------------------- */
/* Startup                                                                     */
/* -------------------------------------------------------------------------- */

buildShell();
buildToolbar();
render();
post({ type: 'ready' });

// Re-fit when the editor is resized so the diagram never drifts off-screen.
let resizeTimer: number | undefined;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    applyView();
    renderStatus();
  }, 120);
});

/** Exposed for debugging from the webview developer tools. */
Object.defineProperty(window, 'ormState', { value: state });
