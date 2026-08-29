import { Id, OrmModel } from '../model/types.js';
import { factTypeRect, objectTypeRect } from './geometry.js';

interface Node {
  id: Id;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
}

/**
 * Force-directed layout over object types, with fact types dropped between the
 * types they connect. Deterministic: the same model always lays out the same
 * way, so a re-layout does not shuffle a diagram the modeler has learned.
 */
export function autoLayout(model: OrmModel): OrmModel {
  const next: OrmModel = { ...model, diagram: { ...model.diagram, shapes: { ...model.diagram.shapes } } };
  if (!next.objectTypes.length) return next;

  const nodes = new Map<Id, Node>();
  next.objectTypes.forEach((ot, position) => {
    const rect = objectTypeRect(next, ot);
    const angle = (position / next.objectTypes.length) * Math.PI * 2;
    const radius = 90 + next.objectTypes.length * 14;
    nodes.set(ot.id, {
      id: ot.id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      w: rect.w,
      h: rect.h,
    });
  });

  const edges: [Id, Id, number][] = [];
  for (const ft of next.factTypes) {
    const players = ft.roles.map((r) => r.objectTypeId).filter((id): id is Id => !!id);
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        if (players[i] !== players[j]) edges.push([players[i], players[j], 170]);
      }
    }
  }
  for (const relation of next.subtypeRelations) {
    edges.push([relation.subtypeId, relation.supertypeId, 130]);
  }

  const repulsion = 26000;
  for (let iteration = 0; iteration < 400; iteration += 1) {
    const cooling = 1 - iteration / 400;
    for (const node of nodes.values()) {
      node.vx *= 0.82;
      node.vy *= 0.82;
    }
    const list = [...nodes.values()];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1) {
          dx = (i - j) || 1;
          dy = 1;
          distance = 1;
        }
        const force = repulsion / (distance * distance);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    for (const [sourceId, targetId, rest] of edges) {
      const source = nodes.get(sourceId);
      const target = nodes.get(targetId);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - rest) * 0.06;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }
    // Subtypes settle above their supertypes, matching ORM drawing convention.
    for (const relation of next.subtypeRelations) {
      const sub = nodes.get(relation.subtypeId);
      const sup = nodes.get(relation.supertypeId);
      if (!sub || !sup) continue;
      const desired = sup.y - 110;
      sub.vy += (desired - sub.y) * 0.05;
    }
    for (const node of nodes.values()) {
      const limit = 40 * cooling + 2;
      node.vx = Math.max(-limit, Math.min(limit, node.vx));
      node.vy = Math.max(-limit, Math.min(limit, node.vy));
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  for (const node of nodes.values()) {
    next.diagram.shapes[node.id] = {
      ...next.diagram.shapes[node.id],
      x: Math.round(node.x),
      y: Math.round(node.y),
    };
  }

  placeFactTypes(next, nodes);
  normalize(next);
  return next;
}

function placeFactTypes(model: OrmModel, nodes: Map<Id, Node>): void {
  for (const ft of model.factTypes) {
    const players = ft.roles
      .map((r) => (r.objectTypeId ? nodes.get(r.objectTypeId) : undefined))
      .filter((n): n is Node => !!n);
    if (!players.length) continue;
    const cx = players.reduce((sum, n) => sum + n.x + n.w / 2, 0) / players.length;
    const cy = players.reduce((sum, n) => sum + n.y + n.h / 2, 0) / players.length;

    const spreadX = Math.max(...players.map((n) => n.x)) - Math.min(...players.map((n) => n.x));
    const spreadY = Math.max(...players.map((n) => n.y)) - Math.min(...players.map((n) => n.y));
    const orientation = spreadY > spreadX * 1.4 ? 'vertical' : 'horizontal';

    model.diagram.shapes[ft.id] = {
      ...model.diagram.shapes[ft.id],
      orientation,
      x: 0,
      y: 0,
    };
    const rect = factTypeRect(model, ft);
    model.diagram.shapes[ft.id] = {
      ...model.diagram.shapes[ft.id],
      x: Math.round(cx - rect.w / 2),
      y: Math.round(cy - rect.h / 2),
    };
  }
  separateFactTypes(model);
}

/** Nudges fact types apart when several sit between the same object types. */
function separateFactTypes(model: OrmModel): void {
  const placed: { id: Id; x: number; y: number; w: number; h: number }[] = [];
  for (const ft of model.factTypes) {
    const rect = factTypeRect(model, ft);
    let { x, y } = rect;
    let attempts = 0;
    while (
      attempts < 24 &&
      placed.some((other) => Math.abs(other.x - x) < other.w + 30 && Math.abs(other.y - y) < other.h + 40)
    ) {
      y += 46;
      if (attempts % 3 === 2) x += 34;
      attempts += 1;
    }
    model.diagram.shapes[ft.id] = { ...model.diagram.shapes[ft.id], x: Math.round(x), y: Math.round(y) };
    placed.push({ id: ft.id, x, y, w: rect.w, h: rect.h });
  }
}

/** Shifts everything into positive coordinates with a small margin. */
function normalize(model: OrmModel): void {
  const shapes = Object.values(model.diagram.shapes);
  if (!shapes.length) return;
  const minX = Math.min(...shapes.map((s) => s.x));
  const minY = Math.min(...shapes.map((s) => s.y));
  const offsetX = 60 - minX;
  const offsetY = 60 - minY;
  for (const key of Object.keys(model.diagram.shapes)) {
    const shape = model.diagram.shapes[key];
    model.diagram.shapes[key] = { ...shape, x: Math.round(shape.x + offsetX), y: Math.round(shape.y + offsetY) };
  }
}
