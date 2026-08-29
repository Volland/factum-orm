---
lat:
  require-code-mention: true
---
# Tests

Specifications for the tests that guard the on-disk format and the schema-generation hints described in [[file-format]].

## File format

Covers the envelope, the JSON Schema contract, versioning and extension preservation. These tests exist because the schema and the TypeScript types are two descriptions of one format and can drift apart silently.

### The sample model satisfies the published schema

The model produced by "New ORM Model", serialized, validates against `schema/orm-model-2.schema.json`. This is the check that catches a type added to [[src/model/types.ts#OrmModel]] without a matching schema change.

### The shipped example satisfies the published schema

`examples/hr.orm.json` validates against the same schema, so the file a new user opens first is a correct example of the format rather than only of the editor.

### The schema rejects a misspelled key but allows an x- extension

A misspelled top-level key such as `objectTypess` fails validation, while an `x-` prefixed key passes.

Together these pin down what makes the format both checkable and open: strictness everywhere except the documented extension namespace.

### A version 1 file loads as version 2

A document declaring `version: 1` parses, keeps its name and elements, and reports version 2. Version 2 is additive over version 1, so the upgrade must be a version bump with no other effect.

### Unknown keys survive a round trip

A document carrying `x-` keys, `meta` and an unrecognised `hints` target at model and element level comes back unchanged in those keys after a parse and serialize.

Losing an unknown key would silently discard another tool's data on the next save.

### The published schema matches the one in the repository

`docs/schema/orm-model-2.schema.json`, the copy GitHub Pages serves, is byte-identical to the one in `schema/`. Models point `$schema` at the published URL, so a drifted copy would have other tools validating against the wrong contract.

### The schema url resolves to the published copy

The schema's own `$id` equals [[src/model/types.ts#MODEL_SCHEMA_URL]], and that URL ends in the path the docs site serves. This is what keeps the declared URL, the schema's identity and the published location one thing.

### A new model declares its schema and version

A newly created model carries the `$schema` URL and the current format version, and serializes with `$schema` first. Editors key completion and validation off that first line.

## Schema generation hints

Covers the hints that steer the relational and property graph mappers. A hint that is stored but ignored is worse than no hint, so each one is tested through to the generated DDL rather than only to the mapped schema.

### A table name hint renames the generated table

`hints.relational.tableName` replaces the derived table name, is used verbatim rather than PascalCased, and foreign keys elsewhere in the schema follow the new name.

### Column name and SQL type hints reach the DDL

`hints.relational.columnName` and `sqlType` on a value type appear in the generated SQL as written, the type replacing the one that would have been derived from `dataType`.

### A schema name hint qualifies every table

A model-level `hints.relational.schemaName` qualifies every `CREATE TABLE` and every `REFERENCES` clause, so the generated script targets one named schema.

### A separateTable hint overrides absorption

`hints.relational.mapping: "separateTable"` on a functional binary stops Rmap absorbing it as a column, giving it a table of its own instead. This is the one hint that changes a mapping decision rather than a name.

### A graph label hint renames a node table

`hints.graph.label` renames the node table, relationships point at the new name, and extra `labels` reach the generated script as a comment because LadybugDB gives a node table exactly one label.

### A graph property name hint renames an absorbed property

`hints.graph.propertyName` renames the property a lexical value type folds into, on the value type or on the role that plays it.

### A property mapping hint is refused when it would lose facts

`hints.graph.mapping: "property"` on a value type played many-to-many is refused: the value becomes a node and the mapping notes say why. A single-valued property cannot hold many values, so obeying the hint would drop facts.

### Column comments do not swallow the separator

Every column line in a generated `CREATE TABLE` carries its comma before the `--`, and only the last line of a table has none. A comment placed before the separator comments it out, and the statement silently becomes invalid SQL.

### A description becomes a generated comment

`meta.description` on an object type is emitted as the comment on its table in the SQL and on its node table in the Cypher, in place of the comment the mapper would otherwise generate.

## Interchange

Covers the converters for the other fact-based modelling formats, described in [[interop#Interoperability#The converters]]. Each is tested through the shape it has to preserve rather than byte-for-byte, because two formats never agree on incidental detail.

### FBM predicate parts become placeholder readings

A `FactTypeReading` split into predicate parts comes back as `{0} works for {1}` with the role order the parts declared. This is the one structural difference between the two conceptual formats, so it is where a reading breaks first.

### FBM mandatory roles become mandatory constraints

A role carrying `Mandatory="true"` produces a simple mandatory constraint on that role. FBM records mandatory on the role and Factum as a constraint of its own, so nothing else would carry it.

### FBM descriptions and guids reach meta

`GUID`, `LongDescription` and `ShortDescription` land in `meta.guid`, `meta.description` and `meta.shortDescription`, and a reference mode and data type survive. These are the fields that make a round trip through another tool worth doing.

### A model survives an FBM round trip

Exporting a model to FBM and reading it back preserves every object type, fact type, subtype relation and constraint, and every primary reading. FBM is conceptual on both sides, so anything lost here is a converter bug rather than a format limit.

### FBM boolean attributes keep their value

The exported XML contains `Mandatory="true"`, not a bare `Mandatory` flag. The XML builder abbreviates boolean attributes by default, which the XSD rejects and a re-import reads as absent — silently dropping every mandatory constraint.

### FBM composite ring types are split

`RingConstraintType="AsymmetricIntransitive"` becomes the two ring types it names. FBM concatenates them into one attribute, so the names have to be matched longest-first or `strictlyIntransitive` is read as `intransitive`.

### Ossie verbalizations become placeholder readings

`{Person} works for {Company}` is read back as `{0} works for {1}`, including the case where one concept plays two roles and the role name disambiguates them. Ossie names placeholders by concept where Factum numbers them by position.

### Ossie multiplicity becomes uniqueness

`ManyToOne` produces a uniqueness constraint over every role but the last, `OneToOne` adds the reverse, and a relationship named in `identify_by` gets a preferred identifier. A relationship with no multiplicity stays many-to-many.

### Ossie extends resolves data types and subtyping

`Salary extends NrDollars extends Decimal` gives Salary a decimal data type, and `extends` naming a declared concept subtypes it while naming a built-in does not.

Getting that distinction wrong turns every value type into a subtype of `Integer`.

### Ossie requires expressions become value constraints

An equality disjunction becomes a list of allowed values and a comparison becomes a bound, with the inclusivity the operator implies. Expressions that are not one of those two shapes are kept as a note rather than guessed at.

### An ontology survives an Ossie round trip

Exporting an imported ontology and reading it back preserves the shape and every reading. Built-in concepts are the trap: re-declaring them on export turns `extends: [Integer]` into a subtype link on the next import.

### Ossie export reports what it cannot carry

Exporting a model with an objectified fact type warns that Ossie has no objectification. An export that quietly drops a construct is worse than one that refuses.

### UMS export produces types with properties

The exported document has types with labels, primary keys, properties and relationships, and carries the readings as the fact-based annotation UMS keeps. This is the property graph mapping's result in UMS's vocabulary.

### UMS import warns that it is a logical schema

Importing UMS produces a usable model and warns that the attributes have already been formed. The warning matters more than the model: what comes back is the shape of the data, not the elementary facts behind it.

### A model survives a NORMA round trip

Exporting to NORMA and reading it back through the existing importer preserves the shape and the readings. This is what makes the NORMA bridge two-way rather than one-way.

### NORMA value constraints are nested where the importer reads them

Value constraints are written inside a `ValueRestriction` on the object type or role, not in the `Constraints` collection. NORMA puts them there, and an exporter that lists them with the other constraints loses every one.

### The format of a document is detected

The format is taken from the extension where that is decisive, and from a marker in the text where it is not. Ossie and UMS share `.yaml`, so the extension alone cannot tell them apart.

## Populations

Covers sample facts and the constraint checking they make possible, described in [[file-format#Populations]]. The value of a population is that it can contradict the schema, so most of these tests are about that contradiction being caught.

### A clean population raises nothing

A population obeying every constraint drawn on the model produces no issues. Without this, a checker that reported nothing would be indistinguishable from one that was not running.

### A repeated value breaks a uniqueness constraint

Two rows repeating the value of a uniquely-constrained role are reported against that constraint, naming both row numbers. This is the check that makes a drawn constraint believable.

### A value outside a value constraint is reported

A sample value outside the allowed set is reported against the value constraint. Value constraints are the ones most often written from memory and most often wrong.

### A row of the wrong width is reported

A tuple with fewer or more values than the fact type has roles is reported. Populations are positional, so a mis-sized row silently shifts every value after it.

### Population problems reach the validator

Population issues come back from `validateModel` like any other issue, so they appear in the Problems panel and fail a build without a separate command.

### Sample facts read back as sentences

Each tuple is read back through the fact type's reading with the real values substituted. This is the Substitution Principle, and it is the form a domain expert can confirm or reject.

### Populations survive an FBM round trip

Fact populations and value type instances survive an export to FBM and back. FBM carries both, and discarding them was the largest remaining loss in that round trip.

## Diff

Covers the comparison that turns a model change into reviewable sentences, described in [[tooling#Tooling#Verbalization diff]].

### An unchanged model produces no diff

A model compared with itself reports no change and says so. A diff tool that reports noise on an unchanged input cannot be used to fail a build.

### A relaxed constraint reads as a changed sentence

Dropping a mandatory constraint produces exactly one *changed* sentence — "exactly one" becoming "at most one" — not an addition and a deletion.

Keying lines by element is what makes that possible, and it is the whole reason to diff verbalizations rather than JSON.

### The markdown report is a diff block with counts

The Markdown report renders changes in a `diff` block so a pull request colours them, and carries before-and-after counts for object types, fact types, constraints and sample facts.

## Derivation

Covers building a first-draft model from example data, described in [[tooling#Tooling#Deriving a model from examples]].

### Delimited text is parsed including quoted fields

Quoted fields containing the delimiter, and doubled quotes inside them, are read correctly. Real exported data contains both, and getting either wrong corrupts every column after it.

### An identifying column becomes the reference mode

A unique, complete column becomes the entity's reference mode rather than a fact type of its own, with the entity's own name stripped from it — `Employee(.nr)` from an `employee_nr` column on an `employee` table.

### Data types and enumerations are inferred

Types are inferred from the values, and a column with few distinct values becomes a value constraint. Both are proposed with a note, because a small sample can support a constraint that does not hold in general.

### Uniqueness needs more than a handful of rows

A column distinct across only three rows is not proposed as unique. Every column of a tiny sample tends to be distinct, and a tool that proposes constraints from coincidence trains its user to ignore them.

### The derived model is populated and valid

The derived model carries every example row as a population and passes validation unchanged. A draft that reports errors on the data it was built from would be worse than no draft.

## Drift

Covers comparing a model against an existing database schema, described in [[tooling#Tooling#Schema drift]].

### CREATE TABLE is parsed including multi-word types

Comments, schema-qualified names, quoted identifiers, multi-word types and table-level primary keys are all read correctly. Column types can contain spaces, so the parser cannot simply stop at the first one.

### A matching schema reports no drift

A database matching the model produces no findings. This is the case that runs on every green build, so a false positive here is worse than a missed difference.

### Each kind of difference is reported

Missing tables, missing columns, extra columns, extra tables and nullability differences are each reported with their own kind, so a consumer can act on them separately.

### Reconciling statements are emitted

Drift comes with the `ALTER` and `CREATE` statements that would bring the database to the model, which is what makes the report actionable rather than merely informative.

### Extra tables can be ignored

Tables the model says nothing about can be excluded. A conceptual model usually covers part of a database, so reporting the rest as drift would bury the real findings.

## Command line

Covers the `factum` binary and the MCP server, described in [[tooling#Tooling#The command line]].

### Validate succeeds on a clean model

`validate` exits zero on a clean model and reports how many sample facts it carries.

### Validate exits non-zero on a broken model

A model with a blocking error exits 1. This is the exit code a build depends on, so it is asserted rather than assumed.

### Validate emits workflow commands for CI

`--format github` writes `::error file=…` lines so problems annotate the changed files in a pull request instead of being buried in a log.

### Diff can fail a build when the model changed

`diff --exit-code` exits zero for an unchanged model and non-zero when the model says something new, which is what lets a workflow gate on a conceptual change.

### Derive builds a model from a CSV

`derive` reads a CSV and writes a model file whose entity carries the reference mode taken from the identifying column.

### Convert reaches the interchange formats

`convert --to` writes each of the interchange formats, so the converters are usable without the editor.

### An unknown command explains itself

An unrecognised command prints the usage and exits 1 rather than throwing a stack trace at the user.

### A missing file is an error, not a crash

A path that does not exist is reported as an error with exit code 2, distinguishing a broken invocation from a broken model.

### The MCP server exposes the model tools

The server registers the eight tools an agent needs to work on a model. The tool names are the contract with the agent, so they are asserted directly.
