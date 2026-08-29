import { FactType, Id, ObjectType, OrmModel, Shape } from '../model/types.js';

export const ROLE_W = 26;
export const ROLE_H = 19;
export const OT_MIN_W = 76;
export const OT_PAD_X = 16;
export const OT_H = 34;
export const OT_H_WITH_REF = 44;
export const CONSTRAINT_R = 11;
export const CHAR_W = 6.4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export function shapeOf(model: OrmModel, id: Id): Shape {
  return model.diagram.shapes[id] ?? { x: 60, y: 60 };
}

export function textWidth(text: string, fontSize = 12): number {
  return text.length * CHAR_W * (fontSize / 12);
}

export function objectTypeRect(model: OrmModel, ot: ObjectType): Rect {
  const shape = shapeOf(model, ot.id);
  const nameLine = `${ot.name}${ot.isIndependent ? '!' : ''}`;
  const refLine = ot.kind === 'entity' && ot.refMode ? `(.${ot.refMode})` : '';
  const width = Math.max(OT_MIN_W, textWidth(nameLine) + OT_PAD_X * 2, textWidth(refLine) + OT_PAD_X * 2);
  return {
    x: shape.x,
    y: shape.y,
    w: shape.w ?? Math.round(width),
    h: shape.h ?? (refLine ? OT_H_WITH_REF : OT_H),
  };
}

export function factTypeRect(model: OrmModel, ft: FactType): Rect {
  const shape = shapeOf(model, ft.id);
  const arity = Math.max(1, ft.roles.length);
  const vertical = shape.orientation === 'vertical';
  return {
    x: shape.x,
    y: shape.y,
    w: vertical ? ROLE_W : ROLE_W * arity,
    h: vertical ? ROLE_H * arity : ROLE_H,
  };
}

export function roleRect(model: OrmModel, ft: FactType, roleIndex: number): Rect {
  const base = factTypeRect(model, ft);
  const vertical = shapeOf(model, ft.id).orientation === 'vertical';
  return vertical
    ? { x: base.x, y: base.y + roleIndex * ROLE_H, w: ROLE_W, h: ROLE_H }
    : { x: base.x + roleIndex * ROLE_W, y: base.y, w: ROLE_W, h: ROLE_H };
}

export function center(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function expand(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

export function contains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

export function intersects(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function union(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Point where the segment from `from` to the rectangle's centre crosses the
 * rectangle border. Used to stop connectors at shape edges.
 */
export function borderPoint(rect: Rect, from: Point): Point {
  const c = center(rect);
  const dx = from.x - c.x;
  const dy = from.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  const scaleX = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** Rounded-rectangle border point, pulled in slightly at the corners. */
export function roundedBorderPoint(rect: Rect, from: Point, radius: number): Point {
  const point = borderPoint(rect, from);
  const c = center(rect);
  const nearRight = Math.abs(point.x - (rect.x + rect.w)) < 0.5 || Math.abs(point.x - rect.x) < 0.5;
  const nearTop = Math.abs(point.y - rect.y) < 0.5 || Math.abs(point.y - (rect.y + rect.h)) < 0.5;
  if (nearRight && nearTop) {
    const pull = radius * 0.3;
    return { x: point.x + (c.x - point.x > 0 ? pull : -pull), y: point.y + (c.y - point.y > 0 ? pull : -pull) };
  }
  return point;
}

export function snap(value: number, grid: number, enabled: boolean): number {
  return enabled ? Math.round(value / grid) * grid : Math.round(value);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint of a set of rectangles, used to place external constraint shapes. */
export function centroid(rects: Rect[]): Point {
  if (!rects.length) return { x: 0, y: 0 };
  const sum = rects.reduce(
    (acc, rect) => {
      const c = center(rect);
      return { x: acc.x + c.x, y: acc.y + c.y };
    },
    { x: 0, y: 0 },
  );
  return { x: sum.x / rects.length, y: sum.y / rects.length };
}
