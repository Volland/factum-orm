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
