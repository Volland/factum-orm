## Context

`OrmModel.diagram` is a single `{ name?, shapes }` record keyed by element id. Every consumer — the renderer, geometry, auto-layout, the editor's drag and create code, the FBM exporter — reads `model.diagram.shapes`. The renderer draws every object type and fact type in the model; an element without a shape is drawn at a default position. `Shape.hidden` exists in the type and the schema ("exists in the model but not on this diagram") but the renderer ignores it.

## Goals / Non-Goals

**Goals:**
- A model can have any number of named pages; one element can appear on several of them.
- Existing single-page files keep loading, rendering and saving byte-for-byte the same.
- A NORMA or FBM model with many pages imports with all of them.
- The renderer, geometry and auto-layout need no knowledge of pages.

**Non-Goals:**
- Several shapes for the same element on one page (NORMA allows duplicates on a page; the importer keeps the first).
- Writing diagram geometry to NORMA on export — still out of scope, for the reason recorded in `lat.md/interop.md`.
- Page-to-page navigation links drawn on the canvas.
- Printing or exporting all pages at once.

## Decisions

### `diagram.pages`, not a version 3 `diagrams` array

A `diagrams: Diagram[]` replacing `diagram` would be the cleanest shape, but it removes a key, which the versioning rule says needs version 3 and a migration — and every other tool reading version 2 would break. Nesting further pages inside `diagram` is additive: a reader that ignores `pages` still sees a valid first page, the top level keeps its "four collections plus the diagram" shape, and the version stays 2.

Pages are addressed by position (0 is `diagram`, `n` is `diagram.pages[n-1]`). They carry an optional `name` and allow `x-` extensions, like `diagram`. No page id was added: nothing in the model refers to a page, and an id would be one more thing to keep unique.

### Membership rule, and why unplaced elements go to the first page

An element is on page `p` if `p` holds a shape for it that is not `hidden`. An object type that objectifies a fact type is drawn as a frame around it, so it follows its fact type. A subtype link is drawn when both ends are on the page; a constraint is drawn when every role it constrains is on the page — the renderer already skips constraints whose roles it cannot find.

An element with no shape on **any** page is on the first page. This keeps today's behaviour for every single-page file (where elements without shapes are drawn), and it means an element added to the JSON by hand, or by a generator that writes no layout, is visible somewhere instead of silently absent.

The consequence is that "not on any diagram" must be written explicitly: a hidden shape on the first page. That is exactly what `hidden` was documented to mean, and it is what "Remove from page" writes when it removes an element's last placement, and what deleting a page writes for elements that were only on it.

### A page view instead of teaching the renderer about pages

`pageView(model, index)` returns an `OrmModel` whose collections are filtered to what the page draws and whose `diagram` is that page, sharing the page's `shapes` object. The renderer, geometry, bounds, hit-testing, marquee selection and auto-layout run on the view unchanged. Writes go through `pageShapes(model, index)`, which returns the same record, so a drag frame that writes into it is visible to the next render.

### Editor

- The active page index and the per-page pan/zoom live in webview state and are saved with `vscode.setState`, so a reload returns to the same page.
- The page bar sits above the status bar. Double-clicking a tab renames it in place (webviews have no `prompt()`); the tab's × deletes the page (undoable, so no confirmation — webviews have no `confirm()` either).
- Creating an element places it on the active page. Auto-layout lays out the active page only.
- The host's undo/redo can remove the active page; the index is clamped on every model update.

### Import

NORMA: each `<ORMDiagram>` becomes a page, in document order, named from `@Name`. Shapes are read from `<Shapes>` and, for tolerance, from direct children. Coordinates are normalised per page. Constraint shapes are stored at their centre, which is what the renderer draws a constraint circle around.

FBM: each `<Page>` becomes a page; export writes one `<Page>` per page.

## Risks / Trade-offs

- **A reader that ignores `pages` shows only the first page** → acceptable degradation; nothing is lost on a round trip because `parseModel` preserves the key.
- **Unplaced elements pile up on the first page of an imported model** (NORMA models can hold elements on no diagram) → they are drawn at the default position; the user can remove them from the page or auto-layout it. The importer marks elements that are on no NORMA diagram as hidden on the first page, so a NORMA model opens as NORMA shows it.
- **Deleting a page makes elements that were only on it invisible** → they stay in the model with hidden shapes on the first page and can be placed again from the "add to this page" picker; the delete is undoable.
