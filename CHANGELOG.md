# Changelog

## 0.3.0 — 2026-08-29

- **Import and export for the other fact-based modelling formats.** `ORM: Import Model` reads NORMA
  `.orm`, the FBM Exchange MetaModel `.fbm`, an Apache Ossie ontology or a Unified Modelling Schema
  document; `ORM: Export Model As` writes any of the four back out. The reader is chosen from the
  file, since Ossie and UMS share `.yaml`.
- FBM and NORMA round-trip the whole conceptual model. Ossie round-trips everything it models —
  objectification and the diagram have no counterpart. UMS export is faithful; UMS import recovers
  the logical schema rather than the model behind it, and says so.
- Both directions report what they could not carry instead of dropping it silently.
- The NORMA bridge is now two-way: `exportNormaFile` completes the pair the importer started.

## 0.2.0 — 2026-08-29

- **File format version 2.** Every element may now carry `meta` (descriptive metadata: `guid`,
  `uri`, `title`, `shortDescription`, `description`, `synonyms`, `tags`, `aiContext`, `source`) and
  `hints` (per-target schema generation guidance). Version 2 is additive over version 1, so existing
  files load unchanged and are written back as version 2.
- Published a JSON Schema (2020-12) for `.orm.json` at `schema/orm-model-2.schema.json`, registered
  through `contributes.jsonValidation`, so VS Code validates and completes a model in the plain text
  editor. New models write a `$schema` line pointing at it.
- Generation hints are honoured by the mappers: `hints.relational` (`schemaName`, `tableName`,
  `columnName`, `sqlType`, `mapping`) and `hints.graph` (`label`, `labels`, `propertyName`,
  `mapping`). A hint that would lose facts — asking for a `property` mapping on a value type played
  many-to-many — is refused and explained in the mapping notes. `meta.description` becomes the
  comment on the generated table and node table.
- Any key beginning with `x-` is a vendor extension, preserved verbatim on load and save. The loader
  keeps every unrecognised top-level key, so nothing another tool wrote is lost on the next save.
- Readings may carry a BCP 47 `lang`, with a model-level default, so multilingual models survive a
  round trip.
- The NORMA importer records provenance in `generator` and `meta.source`.
- Fixed generated SQL DDL being invalid whenever a column carried a comment: the separating comma was
  emitted after the `--`, so the comment swallowed it and the column list lost its separator.
- New documentation page comparing `.orm.json` with NORMA `.orm`, the FBM Exchange MetaModel, the
  Unified Modelling Schema and Apache Ossie, covering why Factum keeps its own format and which
  standards it follows. The `.orm.json` reference page gained a table of contents, section anchors
  and sections on metadata, hints and extensions.
- The JSON Schema is now published on the documentation site, so the `$schema` URL a model declares
  resolves.
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
