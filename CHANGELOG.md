# Changelog

## Unreleased

- Renamed the extension to **Factum** (`factum-orm`); the diagram custom editor view type is now
  `factum.diagram`. Command identifiers (`orm.*`) and settings (`orm.*`) are unchanged.
- Added a marketplace icon.
- Labeled property graph mapping with LadybugDB Cypher DDL generation
  (`ORM: Generate Property Graph Schema (LadybugDB)`) and a *Graph* tab in the side panel.
  Uniqueness constraints become relationship multiplicities, lexical value types become properties,
  and n-ary or objectified fact types are reified into nodes with one relationship per role.
  Constraints the schema cannot enforce are emitted as verbalized comments.
- New settings `orm.graph.subtypeStrategy` and `orm.graph.ifNotExists`.
- Objectified fact types are now drawn correctly: the frame around the fact type *is* the object
  type, so connectors target the frame instead of a duplicate box beside it.
- Unary fact types show their predicate without a leading ellipsis.
- Fixed `npm test` matching no test files, so the suite reported success without running.

## 0.1.0

First release.

- Visual ORM 2 diagram editor for `.orm.json` files, opened as a VS Code custom editor.
- Entity types, value types, reference modes, unary to n-ary fact types, subtyping and objectification.
- Uniqueness (internal, external, preferred identifier), mandatory (simple and disjunctive), frequency,
  ring, subset, exclusion, equality, value and cardinality constraints.
- FORML verbalization in a side panel and as a generated Markdown document.
- Rmap-style relational mapping with SQL DDL generation for PostgreSQL, SQL Server, MySQL, SQLite and ANSI.
- Model validation surfaced in the Problems panel.
- SVG and PNG export, force-directed auto-layout.
- Importer for NORMA / ORM 2 `.orm` XML files.
