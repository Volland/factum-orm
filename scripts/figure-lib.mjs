/**
 * Renders ORM diagrams to standalone SVG using the extension's own renderer,
 * so every figure in the documentation is real ORM 2 notation produced by the
 * same code that draws the editor — not a hand-drawn approximation.
 *
 * Requires the test build: `npm run pretest` (tsc -p tsconfig.test.json).
 */
import { writeFileSync } from 'node:fs';
import { installDomShim } from '../out-test/test/domShim.js';

installDomShim();

const { renderDiagram, diagramBounds } = await import('../out-test/src/webview/render.js');
const { autoLayout } = await import('../out-test/src/webview/autolayout.js');

/** Dark palette matching the documentation site. */
const FIGURE_CSS = `
text { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; fill: #ece9f5; }
.ot-box { fill: #221d33; stroke: #ded9ef; stroke-width: 1.5; }
.ot-box.value-type { stroke-dasharray: 5 3; }
.ot-box.objectified { fill: none; }
.ot-name { font-size: 12.5px; font-weight: 600; }
.ot-refmode { font-size: 10.5px; fill: #a49dbd; }
.role-box { fill: #221d33; stroke: #ded9ef; stroke-width: 1.3; }
.role-box.unattached { stroke-dasharray: 3 2; stroke: #ff6b6b; }
.role-connector { stroke: #b9b3cf; stroke-width: 1.3; }
.reading { font-size: 11.5px; fill: #cfc9e2; }
.role-name { font-size: 10px; fill: #a49dbd; font-style: italic; }
.mandatory-dot { fill: #c58af9; stroke: none; }
.uniqueness-bar { stroke: #c58af9; stroke-width: 2.2; }
.uniqueness-gap { stroke: #c58af9; stroke-width: 1; stroke-dasharray: 3 3; }
.frequency-bar { stroke: #c58af9; stroke-width: 2.2; stroke-dasharray: 6 3; }
.frequency-text { font-size: 10.5px; fill: #c58af9; }
.constraint-circle { fill: #221d33; stroke: #c58af9; stroke-width: 1.7; }
.constraint-glyph { font-size: 11px; fill: #c58af9; }
.constraint-link { stroke: #c58af9; stroke-width: 1.2; stroke-dasharray: 4 3; }
.constraint-arrow { fill: #c58af9; }
.subtype-line { stroke: #ded9ef; stroke-width: 1.5; }
.subtype-arrow { fill: #ded9ef; }
.objectification { fill: none; stroke: #ded9ef; stroke-width: 1.3; }
.objectification-name { font-size: 11.5px; font-weight: 600; }
.value-constraint { font-size: 10.5px; fill: #c58af9; }
.derivation-mark { font-size: 12px; fill: #cfc9e2; }
`;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (value) => String(value).replace(/[&<>"]/g, (c) => ESCAPES[c]);

function toXml(node) {
  if (node.tag === '#text') return escape(node.text ?? '');
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => ` ${key}="${escape(value)}"`)
    .join('');
  if (!node.children.length) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${node.children.map(toXml).join('')}</${node.tag}>`;
}

/** Fills in defaults so figure definitions stay short and readable. */
export function defineModel(spec) {
  return {
    version: 1,
    name: spec.name,
    objectTypes: spec.objectTypes ?? [],
    factTypes: spec.factTypes ?? [],
    subtypeRelations: spec.subtypeRelations ?? [],
    constraints: spec.constraints ?? [],
    diagram: { shapes: spec.shapes ?? {} },
  };
}

/**
 * `scale` renders the SVG larger than its user units so the 12px diagram text
 * sits comfortably beside 16px body text; the viewBox is unchanged, so the
 * figure stays vector-sharp at any size.
 */
export function renderFigure(model, { margin = 6, scale = 1.4 } = {}) {
  const laid = Object.keys(model.diagram.shapes).length ? model : autoLayout(model);
  const root = renderDiagram(laid, {
    selection: new Set(),
    selectedRoles: new Set(),
    showGrid: false,
    gridSize: 10,
    problems: new Map(),
  });
  const bounds = diagramBounds(laid);
  const width = Math.ceil(bounds.w + margin * 2);
  const height = Math.ceil(bounds.h + margin * 2);
  const viewBox = `${Math.floor(bounds.x - margin)} ${Math.floor(bounds.y - margin)} ${width} ${height}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" role="img">`,
    `<style>${FIGURE_CSS}</style>`,
    toXml(root),
    `</svg>`,
  ].join('\n');
}

/** Writes the figure and the model file the reader can open in the extension. */
export function writeFigure(slug, model, options) {
  writeFileSync(`docs/assets/book/${slug}.svg`, renderFigure(model, options));
  writeFileSync(`docs/models/${slug}.orm.json`, `${JSON.stringify(model, undefined, 2)}\n`);
  return slug;
}
