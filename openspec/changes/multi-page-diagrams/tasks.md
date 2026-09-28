## 1. Format and model

- [x] 1.1 Add `DiagramPage` and `Diagram.pages` to `src/model/types.ts`
- [x] 1.2 Add `src/model/pages.ts`: page access, membership, page view, add/rename/move/delete page, place/remove element
- [x] 1.3 `parseModel` keeps valid pages; `deleteElement` removes an element's shape from every page
- [x] 1.4 Add `diagram.pages` and `diagramPage` to the JSON Schema and its published copy

## 2. Renderer

- [x] 2.1 `diagramBounds` ignores hidden shapes

## 3. Editor

- [x] 3.1 Active page state, per-page view, saved with `setState`
- [x] 3.2 Render, hit-test, drag, create, auto-layout, zoom-to-fit and export on the active page
- [x] 3.3 Page bar: switch, add, rename in place, delete
- [x] 3.4 "Add to this page" picker
- [x] 3.5 Properties: pages list with place/remove for object and fact types; pages section with reorder in the model properties
- [x] 3.6 Reveal switches page; clamp page index on update

## 4. Interchange

- [x] 4.1 NORMA import: read `<Shapes>`, import every diagram as a page, per-page normalisation, centre constraint shapes, hide unplaced elements
- [x] 4.2 FBM import every `<Page>`; FBM export every page

## 5. Tests and docs

- [x] 5.1 Tests for membership, page operations, parse round trip, schema, NORMA pages, FBM round trip
- [x] 5.2 `lat.md/file-format.md`, `lat.md/interop.md`, `lat.md/tests.md`
- [x] 5.3 `docs/file-format.html`, `docs/reference.html`, `CHANGELOG.md`
- [x] 5.4 `lat check`, `npm test`, `npm run typecheck`
