/**
 * Styles inlined into exported SVG/PNG files. The on-screen diagram uses VS
 * Code theme variables, which do not exist outside the editor, so exports get
 * this fixed light palette instead.
 */
export const EXPORT_CSS = `
text { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; fill: #1c1c1c; }
.ot-box { fill: #ffffff; stroke: #1c1c1c; stroke-width: 1.4; }
.ot-box.value-type { stroke-dasharray: 5 3; }
.ot-name { font-size: 12px; font-weight: 600; }
.ot-refmode { font-size: 10px; fill: #555555; }
.role-box { fill: #ffffff; stroke: #1c1c1c; stroke-width: 1.2; }
.role-box.unattached { stroke-dasharray: 3 2; stroke: #b00020; }
.role-connector { stroke: #1c1c1c; stroke-width: 1.2; }
.reading { font-size: 11px; fill: #333333; }
.role-name { font-size: 10px; fill: #555555; font-style: italic; }
.mandatory-dot { fill: #6a1b9a; stroke: none; }
.uniqueness-bar { stroke: #6a1b9a; stroke-width: 2; }
.uniqueness-gap { stroke: #6a1b9a; stroke-width: 1; stroke-dasharray: 3 3; }
.frequency-bar { stroke: #6a1b9a; stroke-width: 2; stroke-dasharray: 6 3; }
.frequency-text { font-size: 10px; fill: #6a1b9a; }
.constraint-circle { fill: #ffffff; stroke: #6a1b9a; stroke-width: 1.6; }
.constraint-glyph { font-size: 11px; fill: #6a1b9a; }
.constraint-link { stroke: #6a1b9a; stroke-width: 1.1; stroke-dasharray: 4 3; }
.constraint-arrow { fill: #6a1b9a; }
.subtype-line { stroke: #1c1c1c; stroke-width: 1.4; }
.subtype-arrow { fill: #1c1c1c; }
.objectification { fill: none; stroke: #1c1c1c; stroke-width: 1.2; }
.objectification-name { font-size: 11px; font-weight: 600; }
.value-constraint { font-size: 10px; fill: #6a1b9a; }
.derivation-mark { font-size: 12px; fill: #333333; }
`;
