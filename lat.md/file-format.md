# File format

A model is one JSON document, `*.orm.json`, holding the ORM 2 conceptual schema and its diagram layout in a flat, id-addressed structure. Version 2 adds metadata, schema-generation hints and vendor extensions to every element.

The structure itself is the TypeScript in [[src/model/types.ts#OrmModel]]; this section records why it is shaped that way and what the additions are for. The interchange formats it has to live alongside are compared in [[interop]].

## Envelope

The top level carries a `$schema` URL, a numeric `version`, the model `name`, and the four element collections plus the diagram. Everything else at the top level is optional.

Two things make the envelope self-describing rather than merely conventional:

- `$schema` names the JSON Schema in `schema/orm-model-2.schema.json`. Because the extension registers it under `contributes.jsonValidation`, the plain text editor validates a `.orm.json` file as it is typed and completes keys from the schema's descriptions — the same contract a downstream tool in any language can compile.
- `version` is the format's major version, currently `2` — see [[src/model/types.ts#MODEL_FORMAT_VERSION]]. A version 1 document is a valid version 2 document, because version 2 only adds optional keys.

`generator` records the software that wrote the file, and `lang` gives a BCP 47 default for readings that carry no language of their own.

### Publishing the schema

The `$schema` URL has to resolve, so the schema is served from the documentation site at `docs/schema/orm-model-2.schema.json` as well as living in `schema/`.

Two things have to stay equal for that to hold: the published copy and the source, and the schema's own `$id` and [[src/model/types.ts#MODEL_SCHEMA_URL]]. Both are asserted by [[tests#File format#The published schema matches the one in the repository]] and [[tests#File format#The schema url resolves to the published copy]], because a drifted copy would have other tools validating against a format this one no longer writes.

The extension ships its own copy through `contributes.jsonValidation`, so validation inside VS Code does not depend on the network — the published copy exists for everyone else.

## Metadata

Every element may carry a `meta` object: descriptive information that never changes what the conceptual schema means.

It exists so a model survives a round trip through another fact-based modeling tool, and so generators have something to say beyond an element's name.

The fields are chosen to have a counterpart in the formats Factum has to interoperate with, rather than invented:

| Field | Counterpart |
| --- | --- |
| `guid` | FBM `GUID`, NORMA element ids |
| `uri` | RDF/OWL identity, for ontology alignment |
| `shortDescription`, `description` | FBM `ShortDescription`, `LongDescription` |
| `synonyms` | FBM `Synonyms`, Ossie `ai_context.synonyms` |
| `aiContext` | Ossie `ai_context` |
| `source` | provenance an importer records |
| `title`, `tags` | display name and free classification |

`guid` is what other tools key on. Factum's own ids are short and readable so that diffs stay small, which makes them a poor cross-tool identity: renaming one is a legitimate local edit. A NORMA import is the one case where the two coincide, because the importer keeps the NORMA GUIDs as ids — see [[src/io/normaImport.ts#importNormaFile]].

`meta.description` is not inert: the relational and graph mappers prefer it over their generated comment, so documentation written once in the model reaches the SQL and the Cypher. [[src/model/model.ts#describe]] resolves it.

## Populations

A fact type may carry `population`: sample tuples, one value per role in the fact type's own role order. A value type may carry a flat list of the values it takes.

Populations are what fact-based modelling starts from — the modeller writes example sentences and the model is derived from them. Keeping them in the file makes four things possible that are otherwise out of reach:

- [[src/core/population.ts#verbalizePopulation]] substitutes the real values back into the reading, which is the check a domain expert can actually perform;
- [[src/core/population.ts#checkPopulation]] tests the drawn constraints against the examples, so a uniqueness constraint the data contradicts is reported rather than believed;
- the examples become seed data and test fixtures;
- FBM and NORMA round trips stop discarding the `Instance` and `Fact` elements they carry.

A population disagreeing with a constraint is an error, not a warning: one of the two is wrong, and either answer is worth having. See [[tooling#Tooling#Deriving a model from examples]] for the other direction, where the model is derived from the data.

## Hints

A `hints` object attaches per-target guidance for schema generation.

The rule that keeps hints safe is that **a hint never changes the conceptual schema, only how that schema is rendered** — dropping every hint from a file must leave a model that says exactly the same thing.

`hints.relational` covers `schemaName` (model level), `tableName`, `columnName`, `sqlType` and `mapping`. `hints.graph` covers `label`, `labels`, `propertyName` and `mapping`. A name given in a hint is a physical name and is emitted verbatim, without the PascalCase or camelCase conversion the mappers otherwise apply — that is the whole point of writing one.

Unknown target keys are legal and preserved, so a downstream tool can carry `hints.ossie` or `hints.typedb` without a format change. [[src/model/model.ts#hintsFor]] reads any target; [[src/model/model.ts#stringHint]] is the guarded string accessor the mappers use, because a hand-edited file is not trusted to have the right types.

### Refusing a hint

A hint that would make the generated schema lose facts is refused rather than obeyed, and the refusal is explained in the mapping notes.

The case that arises in practice is `hints.graph.mapping: "property"` on a value type played many-to-many: a single-valued property cannot hold many values, so [[src/core/lpg.ts#planValueTypes]] promotes it to a node anyway and says why.

## Extensions

Any key beginning with `x-` is an extension: legal anywhere, ignored by the editor, and written back unchanged. This is the OpenAPI convention, and it is the mechanism by which another tool can round-trip data Factum has no concept for.

The loader is more permissive than the schema on purpose. [[src/model/model.ts#parseModel]] preserves *every* unrecognised top-level key, not only `x-` ones, and [[src/model/model.ts#serializeModel]] writes them back after the keys it owns. So a misspelled key produces a schema warning in the editor rather than silent data loss on the next save.

## Versioning

The format uses a single integer major version. Version 2 is additive over version 1, so upgrading is a version bump and nothing else — [[src/model/model.ts#parseModel]] performs it on load, and the next save writes `2`.

A future change that removes or repurposes a key needs version 3 and a real migration. Adding an optional key, a new `meta` field, or a new hint target does not: those are what `x-` extensions and the open `hints` object exist to absorb.
