## Why

A real ORM model does not fit on one diagram. NORMA models are routinely split into pages — the `Insurance.orm` model in [activefacts-examples](https://github.com/cjheath/activefacts-examples) has 7, `Metamodel.orm` has 15, and production models reach 30 or more. Factum keeps one page per model, so every element of such a model lands on a single canvas, which a user reported as unusable.

It is worse than one crowded page: the NORMA importer reads shapes directly under `<ORMDiagram>`, but NORMA nests them in `<ORMDiagram><Shapes>`, so a real NORMA file imports with **no** geometry at all. The unit test fixture omits the `<Shapes>` wrapper, which is why this went unnoticed.

## What Changes

- **File format (additive, stays version 2):** `diagram` gains an optional `pages` array. `diagram` itself remains the first page; each entry of `diagram.pages` is a further page with its own `name` and `shapes`. An element may be drawn on several pages, with one shape per page.
- **Page membership rule:** an element is on a page when that page holds a non-hidden shape for it. An element with no shape on any page is drawn on the first page, so every existing single-page file renders exactly as before.
- **Editor:** a page bar under the canvas lists the pages; the user can switch, add, rename, delete and reorder pages. Pan and zoom are kept per page. Moving, creating, auto-layout and SVG/PNG export act on the active page only. The properties panel shows which pages an element is on and lets the user place it on, or remove it from, any page. An "add to this page" picker places an existing element that is not yet on the active page. Revealing an element (from Problems, links, the host) switches to a page that draws it.
- **Delete vs remove:** Delete still removes an element from the model. "Remove from page" removes only its shape from the active page; when that was its last placement it is kept on the first page as a hidden shape, so it does not reappear on the first page uninvited.
- **NORMA import:** reads shapes from `<Shapes>` (the fix above) and imports every `<ORMDiagram>` as a page, each normalised to the canvas origin on its own.
- **FBM import/export:** every `<Page>` is imported and exported, instead of only the first (with a warning).
- **JSON Schema:** `diagram.pages` and the `diagramPage` definition are added to `schema/orm-model-2.schema.json` and to its published copy.
- **Docs:** the file-format page, the reference, `lat.md/`, the changelog and the interop "still missing" list are updated.

## Capabilities

### New Capabilities
- `diagram-pages`: how a model's diagram is split into pages — the file shape, the membership rule, page editing, and import/export of pages.

### Modified Capabilities
<!-- none: there are no existing openspec capability specs in this repository -->

## Impact

- `src/model/types.ts` (`Diagram`, new `DiagramPage`), new `src/model/pages.ts`, `src/model/model.ts` (parse, delete).
- `src/webview/main.ts`, `panels.ts`, `render.ts` (hidden shapes and bounds), `media/style.css`.
- `src/io/normaImport.ts`, `src/io/fbm.ts`.
- `schema/orm-model-2.schema.json`, `docs/schema/orm-model-2.schema.json`, `docs/file-format.html`, `docs/reference.html`, `CHANGELOG.md`, `lat.md/`.
- Tests: format, model, normaImport, interop, render.
- No breaking change: a version 2 reader that ignores `diagram.pages` still reads a valid first page.
