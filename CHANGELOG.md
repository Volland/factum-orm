# Changelog

## 0.4.2 — 2026-08-30

Interchange fixes, all found by running the FactEngine community's
[test models](https://github.com/FactEngineCommunity/Fact-Based-Modelling-MetaModel) — 31 NORMA and
30 Boston files — through import, validation, verbalization and both mappings. None of them failed
to load; they loaded into models that were quietly wrong.

- **Ossie ontologies that nest their concept block now import.** An entry may name its concept inline
  (`concept: Person`) or nest it with its attributes under `concept:`, as FactEngine writes it. Only
  the first form was understood, so every concept in a nested file arrived named by an *object*: no
  value types, no subtyping, no reference schemes, and every role unattached. An entry naming
  nothing is now rejected rather than imported under an object for a name.
- **An Ossie `identify_by` produces a usable preferred identifier.** It was marked on the uniqueness
  over the concept's own role, where nothing looks for it, so every Ossie-imported entity type
  reported having no reference scheme. It now sits on the constraint over the roles opposite the
  concept, and an `identify_by` naming something that cannot carry one — a composite or external
  identifier — is reported instead of marked in the wrong place.
- **NORMA role proxies are read.** An implied fact type borrows a role from the fact type it
  objectifies and states it as a `RoleProxy`, or an `ObjectifiedUnaryRole`, carrying its own id.
  Both were skipped, leaving those fact types a role short of what their own readings referred to —
  and, where the missing role held the preferred identifier, leaving the objectified type
  unidentified.
- **A NORMA unary fact type stays unary.** NORMA stores one as a binary against a value type flagged
  `IsImplicitBooleanValue`. That value type was becoming a real concept named after the reading,
  with a spurious role and value constraint. Both the value type and the role playing it are now
  left out.
- **FBM diagram pages carry the right concept type.** Every shape was exported as `EntityType`, so a
  value type came back to Boston drawn as an entity — reported by the FactEngine community against
  `Test01-ValueType-Single`. A fact type's page instance also named it by internal id rather than by
  the name its `FactType` element was written under, so nothing could match the shape to what it
  drew. On the way in, a page instance is now matched on its concept type: reading text, fact type
  names and constraint markers are drawn as instances too, and taking all of them let an invisible
  marker at the origin overwrite the position of the thing it labels.
- **A subtype link no longer leaves its constraints dangling.** NORMA and FBM both state one as a
  fact type whose meta roles carry the mandatory and uniqueness constraints the link implies. Factum
  carries the link as a subtype relation, so those constraints now go with the roles they name.
  Anything else dangling is still reported.
- Documentation site: a page for **Fact-Based Agents**, the book — ORM 2, FORML and Factum for
  agentic memory. Linked from the landing page, from the mini book's contents, and from the end of
  every mini-book chapter, so a reader who wants the long version of a chapter knows where it is.
- Documentation site: a **human-first, AI-native** rebrand. A new page on why elementary facts are
  the layer language models have been missing, a page on the MCP server aimed at people running a
  coding agent, and two articles — one on the fact layer itself, one on FORML as a context format.
  The landing page leads with the same position.

## 0.4.1 — 2026-08-29

- The JSON Schema moved to the project's own domain: models now declare
  `https://www.factum-orm.com/schema/orm-model-2.schema.json`. The previous address still redirects,
  and a document naming it is upgraded on load, so nothing breaks and the ecosystem converges on one
  URL rather than drifting into two.
- The MCP server advertises the package's real version instead of a literal that drifted each
  release.
- Documentation site: a German **Datenschutzerklärung** in the structure Art. 13 DSGVO expects,
  alongside the existing English privacy page.
- Documentation site: German **Impressum** (§ 5 DDG) and **Nutzungsbedingungen (AGB)** pages, linked
  from the footer of every page.
- Documentation site: a new **Why Factum** page comparing the tool with NORMA, FactEngine Boston and
  CaseTalk, including a section on where each of them is ahead. The landing page now covers the
  command line, the MCP server, sample populations, model derivation and drift detection, and states
  the interchange position directly — all four formats are read and written, so no one has to pick.

## 0.4.0 — 2026-08-29

- **`factum`, a command line over the same core the editor runs.** `validate`, `verbalize`, `ddl`,
  `graph`, `diff`, `drift`, `convert` and `derive`. `validate --format github` emits workflow
  commands so problems annotate a CI run, and `--exit-code` lets a job fail on a finding.
- **A GitHub Action** that validates a model and comments on the pull request with the sentences
  that changed — a tightened constraint reads as `- at most one` / `+ exactly one` rather than as a
  JSON diff.
- **Sample populations.** Fact types carry example tuples and value types carry their instances, in
  the same file. The verbalizer substitutes them back into the readings, and the validator checks
  the constraints against them: a uniqueness, mandatory, frequency or value constraint the examples
  contradict is now reported. Populations also survive the FBM round trip, which previously
  discarded them.
- **Model derivation from example data.** `ORM: Derive Model from Example Data (CSV)` and
  `factum derive` propose a first-draft schema from a table: an identifying column becomes the
  entity's reference mode, types and enumerations are inferred, and every row is kept as a sample
  fact. Each assumption is reported as a note.
- **Schema drift detection.** `factum drift` compares the schema a model maps to against existing
  SQL and emits the statements that would reconcile them. It reads SQL text, so no database driver
  is required.
- **An MCP server** (`factum-mcp`) exposing the model to coding agents: read, verbalize, validate,
  map, diff, detect drift, read the population, and apply a new model. Only `apply_model` writes,
  and it refuses a model with blocking errors.

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
