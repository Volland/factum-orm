## Purpose

Lets a model's diagram be split into named pages, so a large ORM model — or one imported from NORMA or FBM with many diagrams — can be drawn and edited a subject area at a time.

## ADDED Requirements

### Requirement: Pages in the file format
A `.orm.json` document SHALL store its first page in `diagram` and any further pages, in order, in the optional array `diagram.pages`. Each page SHALL be an object with `shapes` (keyed by element id) and an optional `name`, and MAY carry `x-` extensions. The format version SHALL remain 2.

#### Scenario: A single-page file is unchanged
- **WHEN** a document with no `diagram.pages` is loaded and saved
- **THEN** the saved document has no `diagram.pages` key and is otherwise identical to what was written before this change

#### Scenario: Pages survive a round trip
- **WHEN** a document with `diagram.pages` is parsed and serialised
- **THEN** every page, its name, its shapes and its `x-` keys are written back in the same order

#### Scenario: The schema accepts pages
- **WHEN** a document with `diagram.pages` is validated against `orm-model-2.schema.json`
- **THEN** it is valid, and a page with an unknown non-`x-` key is invalid

### Requirement: Page membership
An object type, fact type or free-standing constraint shape SHALL be drawn on a page when that page holds a shape for it whose `hidden` is not `true`. An element with no shape on any page SHALL be drawn on the first page. An object type that objectifies a fact type SHALL be drawn wherever that fact type is drawn. A subtype link SHALL be drawn on a page only when both its subtype and supertype are on it; a constraint SHALL be drawn on a page only when every role it constrains is on it.

#### Scenario: An element on two pages
- **WHEN** an object type has a shape on page 1 and on page 3
- **THEN** it is drawn on both pages, each at its own position, and not on page 2

#### Scenario: An unplaced element falls on the first page
- **WHEN** a model has two pages and a fact type has no shape on either
- **THEN** the fact type is drawn on the first page only

#### Scenario: A hidden shape keeps an element off the diagram
- **WHEN** an element's only shape is a hidden shape on the first page
- **THEN** it is drawn on no page

#### Scenario: A link whose end is off the page
- **WHEN** a subtype's supertype is not on the active page
- **THEN** the subtype link is not drawn on that page

### Requirement: Editing pages
The diagram editor SHALL show the pages as tabs, and SHALL let the user switch to, add, rename, reorder and delete a page. Deleting the last remaining page SHALL NOT be possible. Deleting the first page SHALL make the next page the first. Elements that were only on a deleted page SHALL remain in the model, placed on no page.

#### Scenario: Adding a page
- **WHEN** the user adds a page
- **THEN** an empty page named "Page N" is appended and becomes the active page

#### Scenario: Deleting a page keeps its elements in the model
- **WHEN** the user deletes a page holding an entity type that is on no other page
- **THEN** the entity type remains in the model and is drawn on no page

### Requirement: Editing acts on the active page
Moving shapes, creating elements, auto-layout, zoom-to-fit and SVG/PNG export SHALL act on the active page only. Pan and zoom SHALL be remembered per page.

#### Scenario: Creating an element
- **WHEN** the user adds an entity type while page 2 is active
- **THEN** its shape is written to page 2 only

#### Scenario: Auto-layout
- **WHEN** the user runs auto-layout on page 2
- **THEN** only the shapes of page 2 change

### Requirement: Placing an element on pages
The properties of an object type or fact type SHALL list the pages and whether the element is on each, and SHALL let the user place it on or remove it from any page. The editor SHALL offer a picker of the elements not on the active page and place the chosen one on it. "Remove from page" SHALL remove only the shape; when that was the element's last placement the element SHALL be kept on no page rather than falling back to the first page. Delete SHALL continue to remove the element from the model.

#### Scenario: Removing an element's last placement
- **WHEN** the user removes an object type from the only page it is on
- **THEN** the object type stays in the model and is drawn on no page

#### Scenario: Revealing an element on another page
- **WHEN** the user selects, from the Problems panel, an element that is not on the active page
- **THEN** the editor switches to a page that draws it and reveals it

### Requirement: Importing and exporting pages
The NORMA importer SHALL import every `<ORMDiagram>` as a page, in document order, named from its `Name`, reading shapes nested under `<Shapes>`, and SHALL normalise each page's coordinates on their own. Elements on no NORMA diagram SHALL be imported on no page. The FBM importer SHALL import every `<Page>`, and the FBM exporter SHALL write one `<Page>` per page.

#### Scenario: A seven-page NORMA model
- **WHEN** `Insurance.orm` from activefacts-examples is imported
- **THEN** the model has seven pages named as in NORMA, and each page holds the shapes of its NORMA diagram

#### Scenario: NORMA shapes under Shapes
- **WHEN** a NORMA file nests its shapes in `<ORMDiagram><Shapes>`
- **THEN** the shapes are imported with their positions

#### Scenario: FBM round trip
- **WHEN** a model with three pages is exported to FBM and imported back
- **THEN** it has three pages with the same names and shape positions
