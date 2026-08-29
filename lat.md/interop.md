# Interoperability

Factum's `.orm.json` is one of several formats the fact-based modeling community uses to exchange models, and the design of [[file-format]] is a response to the others. This section records what those formats do and which of their decisions were adopted.

The community has no agreed exchange standard yet; three candidates are in play, and Factum aims to be able to speak to all of them rather than to pick one.

## The formats

Four formats matter, and they sit at different levels of abstraction.

### NORMA `.orm`

The ORM 2 XML written by NORMA, and the format Factum already imports — see [[src/io/normaImport.ts#importNormaFile]].

It is the most faithful ORM 2 metamodel of the four and the de-facto archive format, but it is verbose, Visual Studio-bound, and carries a great deal of tool state alongside the model.

### FBM Exchange MetaModel `.fbm`

An XML format published by the FactEngine community as a deliberate exchange standard for fact-based models — ORM and FCO-IM — with an XSD and ready-made .NET classes.

It is markedly simpler than NORMA's format while covering the same conceptual ground: value and entity types, fact types with role groups, readings decomposed into predicate parts, role constraints with join paths, subtype relationships, model notes, synonyms, and a multi-page diagram section.

Things it carries that Factum did not, and which motivated `meta` and `hints`:

- `GUID` on every element, distinct from the readable `Id`
- `DBName` — a physical name for relational generation
- `GraphLabel` — a label for property graph generation
- `LongDescription` and `ShortDescription` on every element
- a model-level `Synonyms` collection
- `Page/@Language`, so a diagram's readings have a language
- sample populations (`Instance`, `Fact`) alongside the schema

### Unified Modelling Schema (UMS)

A YAML format, also from the FactEngine community, with a JSON Schema and Delphi and VB.NET classes.

Unlike the other three it is *logical* rather than conceptual: the unit is a type with properties, primary keys and relationships, and the fact-based content survives as `FactTypeReadings` attached to them. That makes it a good target for generation and a lossy source, because attributes have already been formed.

### Apache Ossie

An incubating ASF specification for exchanging semantic metadata between analytics, AI and BI platforms, defined as YAML with a published JSON Schema.

Its core spec is a logical semantic model — datasets, fields, relationships, metrics — but its **ontology section is conceptual and close to ORM**: concepts typed `EntityType` or `ValueType`, relationships with ordered roles and named role players, `multiplicity`, `identify_by` for preferred identifiers, `extends` for subtyping, `requires` for constraints, `derived_by` for derivation rules, and `verbalizes` patterns that are readings in all but name. Its `ontology_mappings` then bind concepts and relationships down to fields of a logical dataset.

Ossie is the most likely of the three to become widely adopted, because it has vendor converters and an ASF home rather than a single implementer.

## What was adopted

The comparison produced four decisions, all of which are additive to the existing structure.

### JSON Schema as the contract

All three of the modern formats publish a machine-readable schema — UMS and Ossie as JSON Schema 2020-12, FBM as an XSD — and none of them rely on prose alone.

Factum now does the same in `schema/orm-model-2.schema.json`, which is both the interchange contract and, through `contributes.jsonValidation`, live validation and completion in the text editor.

The schema is strict about unknown keys but exempts `x-` prefixed ones, which is how OpenAPI, AsyncAPI and CloudEvents all handle extension. That combination catches a typo without closing the format.

### Metadata separate from the model

FBM attaches descriptions, GUIDs and synonyms directly to elements as attributes; Ossie attaches `description` and `ai_context`.

Factum groups them into one `meta` object rather than spreading them across an element's own keys, so the conceptual keys stay the ones that carry meaning and everything descriptive is visibly set apart. See [[file-format#Metadata]].

### Hints separate from metadata again

FBM's `DBName` and `GraphLabel` and UMS's `Labels`/`Label` are not descriptions — they steer generation.

Keeping them in `hints`, namespaced per target, means the generators have one place to look and a reader can tell at a glance which keys affect output. See [[file-format#Hints]].

Namespacing by target is what makes a future Ossie bridge cheap: the `concept_mappings` an Ossie document needs are per-element bindings to a dataset and an expression, which is exactly the shape of a `hints.ossie` entry.

### Readings keep their language

FBM pages and UMS readings are both language-tagged. Factum's `Reading` now takes an optional `lang`, with a model-level default, so a multilingual model does not collapse on a round trip.

## What was deliberately not adopted

Two things the other formats carry are still absent, and their absence is a choice rather than an oversight.

**Sample populations.** FBM carries `Instance` and `Fact` elements and UMS carries `Facts` strings. Factum stores no fact instances, so importing them would mean holding data the editor cannot show or check.

**Readings decomposed into predicate parts.** FBM splits a reading into parts with prebound and postbound text; Factum uses NORMA's `{0}`, `{1}` placeholder convention, which is equivalent for binary and n-ary readings and much easier to hand-edit. The hyphen binding FBM's parts express (Ossie writes it as `has description- {String}`) is the one thing the placeholder form does not capture, and it matters only for constraint verbalization.

The comparison is also published for readers, as `docs/interop.html` on the documentation site; this section is the design record behind it.

`docs/compare.html` is its companion, comparing the *tools* rather than the formats — NORMA, FactEngine Boston and CaseTalk against Factum. It is a marketing page, so it carries two obligations the design record does not: every row states what the vendor documents publicly rather than what we assume, and a section says plainly where each competitor is ahead. A comparison that only flatters its author is not worth publishing, and is not believed.

## The converters

Each format has a module in [src/io/](src/io/) that reads and writes it, sharing a vocabulary of data types and name conventions in [[src/io/interop.ts#dataTypeFromNorma]] and its neighbours.

Every converter is tolerant in the way [[src/io/normaImport.ts#importNormaFile]] already was: unknown constructs are skipped and reported as warnings rather than failing the conversion, because a partially-read model is more useful to a modeller than an error message. Both directions return warnings, so an export says what the target format could not hold.

`ORM: Import Model` picks the reader from the file, using [[src/io/interop.ts#detectFormat]] — the extension where it is decisive, and a marker in the text where it is not, because Ossie and UMS share `.yaml`. `ORM: Export Model As` offers the four formats with a note on what each one costs.

### FBM

[[src/io/fbm.ts#importFbmFile]] and [[src/io/fbm.ts#exportFbmFile]] are the highest-fidelity pair, because both sides are conceptual and cover the same constructs.

Two shapes do not line up one-to-one and are where the module spends its effort. FBM decomposes a reading into predicate parts, each contributing a role's placeholder and the text trailing it, where Factum uses NORMA's `{0}` convention; and FBM records mandatory on the role, where Factum makes it a constraint of its own. Ring types are concatenated in FBM — `AsymmetricIntransitive` is two of them — so import splits the name longest-first.

Boston writes `<ORMModel>` and newer exports write `<FBMModel>`; both appear in the metamodel repository's own examples, so both are read.

### Ossie

[[src/io/ossie.ts#importOssieFile]] and [[src/io/ossie.ts#exportOssieFile]] convert the ontology section, which is conceptual and close to term-for-term with ORM.

Three conversions carry the weight. A relationship is grouped under the concept playing its first role, so export buckets fact types by the player of their primary reading's first role. `multiplicity: ManyToOne` is uniqueness over every role but the last, and `OneToOne` adds the reverse. And `verbalizes` names its placeholders by concept — `{Person} works for {Company}` — so both directions match placeholders to roles by player name, falling back to the role name when a concept plays more than one.

Built-in concepts are implicit in every ontology. Import materialises one only when something plays it, and export leaves them out again — otherwise `extends: [Integer]` would come back as a subtype link.

### UMS

[[src/io/ums.ts#exportUmsFile]] runs the property graph mapping and writes its result, because [[src/core/lpg.ts#mapToGraph]] already answers UMS's question: which value types are properties and which fact types are relationships.

[[src/io/ums.ts#importUmsFile]] is the lossy direction and says so in a warning. A property becomes a value type and a binary fact type; a foreign key becomes a binary fact type; `NotNull` becomes mandatory and a primary key becomes a preferred identifier. What cannot be recovered is the model that produced the schema, because the attributes have already been formed.

### NORMA

[[src/io/normaExport.ts#exportNormaFile]] completes the pair the importer started, making the NORMA bridge two-way.

The one structural trap is value constraints: NORMA nests them under the object type or the role in a `ValueRestriction`, not in `<Constraints>` with everything else, so that is where they are written. Diagram geometry is not written at all — NORMA's diagram section carries shape state well beyond position, and a partial one is worse than none.

## Fidelity

What each converter keeps is a property of the formats, not of the effort spent, and it is worth stating plainly rather than discovering.

FBM and NORMA are conceptual and round-trip the whole model: every object type, fact type, reading, constraint and subtype. Ossie round-trips everything it models — objectification and the diagram have no counterpart and are dropped with a warning. UMS is logical, so export is faithful and import recovers the logical shape rather than the model behind it.

The metadata added in format version 2 is what makes the first three work: `meta.guid` carries identity, `hints.relational.tableName` is FBM's `DBName`, `hints.graph.label` is its `GraphLabel`, `meta.synonyms` is `Synonyms`, and `meta.description` is `LongDescription`.

Still missing: FBM sample populations and multi-page diagrams, join paths on set-comparison constraints, and Ossie's `ontology_mappings`, which is where a `hints.ossie` target would land.
