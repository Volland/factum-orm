# The `.orm.json` model format

Factum's working format. Plain JSON, so it diffs and merges like source. Schema:
`https://www.factum-orm.com/schema/orm-model-2.schema.json`.

Ids are strings, unique within the file, and referenced from constraints and the
diagram. Use readable ids (`person`, `works.r0`, `uc-works`) — they show up in
validator messages and in diffs.

## Document

```json
{
  "$schema": "https://www.factum-orm.com/schema/orm-model-2.schema.json",
  "version": 2,
  "name": "Staffing",
  "lang": "en",
  "note": "optional free text",
  "objectTypes": [],
  "factTypes": [],
  "subtypeRelations": [],
  "constraints": [],
  "diagram": { "shapes": {} },
  "meta": {},
  "hints": {}
}
```

`name`, `objectTypes` and `factTypes` are required. `version` is `2`.
Any object may carry `x-`-prefixed keys; they are preserved.

## Object types

```json
{
  "id": "person",
  "name": "Person",
  "kind": "entity",
  "refMode": "nr",
  "refModeKind": "popular",
  "dataType": "string",
  "population": ["101", "102"],
  "isIndependent": false,
  "isPersonal": true,
  "objectifiedFactTypeId": null,
  "meta": {},
  "hints": {}
}
```

- `kind` is `entity` or `value`. **Entity types have a reference scheme; value types
  are lexical and identify themselves.**
- `refMode` is the parenthesised mode: `nr` gives `Person(.nr)`. Entity types only —
  a `refMode` on a value type is the warning `value-type-ref-mode`.
- `refModeKind`: `popular` (the default reading), `unit` (e.g. `km`), `general`.
- `dataType` is one of `string`, `text`, `integer`, `decimal`, `float`, `money`,
  `boolean`, `date`, `time`, `dateTime`, `guid`, `binary`, `autoCounter`. Set it on
  value types; `dataTypeLength` and `dataTypeScale` refine it.
- `population` on an object type is a list of sample instances — a value type's values
  or an entity type's identifiers.
- `isIndependent` (`!` on the diagram) means instances may exist while playing no fact
  role.
- `isPersonal` verbalizes with *who* rather than *that*.
- `objectifiedFactTypeId` makes this entity type the objectification of a fact type;
  set `isImplicitObjectification` when the tool created it rather than the modeller.

An entity type with neither a `refMode` nor a preferred-identifier uniqueness
constraint is the error `no-reference-scheme`.

## Fact types

```json
{
  "id": "works",
  "roles": [
    { "id": "works.r0", "objectTypeId": "person", "name": "employee" },
    { "id": "works.r1", "objectTypeId": "company" }
  ],
  "readings": [
    { "id": "works.rd", "roleOrder": ["works.r0", "works.r1"],
      "text": "{0} works for {1}", "isPrimary": true },
    { "id": "works.rd2", "roleOrder": ["works.r1", "works.r0"],
      "text": "{0} employs {1}" }
  ],
  "population": [
    { "values": ["101", "Acme"] },
    { "values": ["102", "Acme"] }
  ],
  "isDerived": false,
  "isStored": false,
  "derivationRule": "…"
}
```

- One role per participant. Arity is the role count: unary, binary, ternary, n-ary.
- `role.objectTypeId` may be `null` only while a role is mid-connection; a null in a
  saved model is the error `unattached-role`.
- `role.name` is optional and appears in italics on the diagram; use it when the same
  player appears twice (`parent` / `child`).
- **Readings** use `{0}`, `{1}` … indexing into `roleOrder`, the NORMA convention.
  `roleOrder` must name exactly this fact type's roles, and the highest placeholder
  must be in range — otherwise `reading-role-order`, `reading-arity-mismatch` or
  `reading-placeholder-range`. Every fact type needs at least one reading
  (`no-reading`); mark one `isPrimary`.
- **Add the inverse reading whenever a human would say it.** It costs one line and
  doubles the chance a domain expert spots an error.
- `population` tuples are positional, in the fact type's **role order** — not the
  reading's order. `null` means unknown. Populations are checked against the
  constraints, which is how a constraint gets falsified.
- A derived fact type carries `isDerived` and a `derivationRule`; Factum stores and
  verbalizes the rule, it does not evaluate it. `isStored` means derived-and-stored.

## Subtype relations

```json
{ "id": "st-student", "subtypeId": "student", "supertypeId": "person",
  "isPreferredIdentificationPath": true }
```

One relation per arrow. A subtype inherits its supertype's identification; when there
are several possible paths, mark one, or get `ambiguous-identification-path`. Group
relations into a partition with a `subtypeSet` constraint.

## Constraints

Every constraint has `id`, `kind`, an optional `name`, `note` and
`modality` (`alethic`, the default, or `deontic`). Full treatment in
`constraints.md`; the shapes are:

```json
{ "id": "uc",   "kind": "uniqueness",  "roles": ["works.r0"], "isPreferredIdentifier": true }
{ "id": "mc",   "kind": "mandatory",   "roles": ["works.r0"] }
{ "id": "fc",   "kind": "frequency",   "roles": ["sits.r1"], "min": 3, "max": 5 }
{ "id": "rc",   "kind": "ring",        "roles": ["leads.r0", "leads.r1"],
                "types": ["irreflexive", "acyclic"] }
{ "id": "sub",  "kind": "subset",      "roleSequences": [["drives.r0"], ["holds.r0"]] }
{ "id": "vc",   "kind": "value",       "objectTypeId": "rank",
                "ranges": [{ "value": "P" }, { "value": "SL" }, { "value": "L" }] }
{ "id": "cc",   "kind": "cardinality", "objectTypeId": "company", "min": 0, "max": 1 }
{ "id": "ss",   "kind": "subtypeSet",  "supertypeId": "party",
                "subtypeRelationIds": ["st-emp", "st-con"],
                "isExclusive": true, "isExhaustive": true }
```

- `kind` ∈ `uniqueness`, `mandatory`, `frequency`, `ring`, `subset`, `exclusion`,
  `equality`, `value`, `cardinality`, `subtypeSet`.
- `roles` for the internal kinds; `roleSequences` (≥ 2 sequences of equal length) for
  the set-comparison kinds. **For `subset`, the first sequence is the subset and the
  second the superset.**
- A uniqueness constraint spanning roles of *several* fact types is external
  uniqueness — same shape, roles from different fact types.
- `max` may be `null`, meaning unbounded.
- A `value` constraint targets exactly one of `objectTypeId` or `roleId`. Ranges are
  `{"value": x}` for a discrete value, or `min`/`max` with `minInclusive` /
  `maxInclusive` for a range.
- `isImplied` marks a constraint the tool inferred.

## Diagram

```json
"diagram": {
  "name": "main",
  "shapes": {
    "person":  { "x": 40,  "y": 60 },
    "company": { "x": 300, "y": 60 },
    "works":   { "x": 196, "y": 68, "orientation": "horizontal" },
    "uc":      { "hidden": true }
  }
}
```

Keyed by object type, fact type, constraint or subtype-relation id. `x`/`y` are the
top-left in diagram units; `w`/`h` are optional; `orientation` (`horizontal` or
`vertical`) lays out a fact type's role boxes; `hidden` keeps an element in the model
but off this diagram. Layout guidance is in `notation.md`.

## meta and hints — and the line between them

`meta` is descriptive; `hints` steer generation. **Neither changes what the schema
means.** Strip every one of them and the model still says the same thing.

```json
"meta": {
  "guid": "…",                       // stable cross-tool identity, survives NORMA/FBM round trips
  "uri": "https://example.org/ns#Person",
  "title": "Display name",
  "shortDescription": "one line",
  "description": "long form; emitted as a comment by the generators",
  "synonyms": ["booking", "hold"],
  "tags": ["pii"],
  "aiContext": { "instructions": "…", "synonyms": ["…"], "examples": ["…"] },
  "source": { "tool": "NORMA", "version": "…", "ref": "…" }
}
```

```json
"hints": {
  "relational": { "schemaName": "app", "tableName": "employee",
                  "columnName": "emp_name", "sqlType": "varchar(80)",
                  "mapping": "absorb" },
  "graph":      { "label": "Employee", "labels": ["Party"],
                  "propertyName": "name", "mapping": "node" }
}
```

Unknown hint targets are legal and preserved, so a downstream tool can carry its own.
A `graph.mapping: "property"` hint that would lose facts — a value played
many-to-many — is refused rather than silently applied.

**The trap:** a rule that lives only in `meta.aiContext` does not verbalize, does not
validate and does not map. If you want a hint to express a rule, the rule belongs in a
constraint.

## A complete minimal model

```json
{
  "$schema": "https://www.factum-orm.com/schema/orm-model-2.schema.json",
  "version": 2,
  "name": "Many to one",
  "objectTypes": [
    { "id": "person",  "name": "Person",  "kind": "entity", "refMode": "nr" },
    { "id": "company", "name": "Company", "kind": "entity", "refMode": "name" }
  ],
  "factTypes": [
    {
      "id": "works",
      "roles": [
        { "id": "works.r0", "objectTypeId": "person" },
        { "id": "works.r1", "objectTypeId": "company" }
      ],
      "readings": [
        { "id": "works.rd", "roleOrder": ["works.r0", "works.r1"],
          "text": "{0} works for {1}", "isPrimary": true }
      ],
      "population": [ { "values": ["101", "Acme"] }, { "values": ["102", "Acme"] } ]
    }
  ],
  "subtypeRelations": [],
  "constraints": [
    { "id": "uc", "kind": "uniqueness", "roles": ["works.r0"] },
    { "id": "mc", "kind": "mandatory",  "roles": ["works.r0"] }
  ],
  "diagram": {
    "shapes": {
      "person":  { "x": 40,  "y": 60 },
      "company": { "x": 300, "y": 60 },
      "works":   { "x": 196, "y": 68, "orientation": "horizontal" }
    }
  }
}
```

Verbalizes as: *Each Person has exactly one PersonNr… It is possible that some Person
works for some Company. Each Person works for exactly one Company.*
