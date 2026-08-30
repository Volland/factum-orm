---
description: Lay out and render the ORM 2 diagram for a model, or explain an existing one
argument-hint: [path to .orm.json] [layout | render | explain]
---

Diagram: **$ARGUMENTS**

Use the `factum-orm` skill; load `references/notation.md`.

**Layout.** The diagram is the `diagram.shapes` block; your job is placement, not ink.
Write coordinates that follow the layout rules: hub on the left, its value types in a
column on the right, 70 units between rows, the fact type at the midpoint about 8
units below its right-hand partner, subtypes directly below their supertype, circled
constraint glyphs between the roles they span. Keep it under about 600 units wide if
it has to fit a page. Then validate the model and tell me if any reading is long
enough to overflow.

**Render.** In the editor: `ORM: Export Diagram as SVG` or `as PNG`, and
`ORM: Auto-Layout Diagram` (`Ctrl/Cmd+Alt+L`) if a legible arrangement is all I need.
For a batch, drive the extension's renderer from Node and rasterise with
`rsvg-convert`. Say which path you are using and why.

**Explain.** Read the model and walk me through the diagram mark by mark: the three
shapes, what each bar covers, where the dots are and what their absence asserts, what
each circled glyph constrains. Read every fact type aloud as a sentence with a real
instance from the population in it. Call out the uniqueness patterns explicitly — one
bar, two bars, or one spanning bar — because that is the mark people misread.

If no mode was named, infer it: an unplaced or overlapping model needs layout, a
question about meaning needs explain.
