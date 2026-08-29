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

## Still to build

The metadata added here is what a converter needs, not the converter itself.

An FBM `.fbm` exporter, an Ossie ontology exporter, and a `.orm` writer to make the NORMA importer two-way are all now expressible against this format: `meta.guid` carries identity, `hints.relational.tableName` is `DBName`, `hints.graph.label` is `GraphLabel`, `meta.synonyms` is `Synonyms`, and `meta.description` is `LongDescription`.
