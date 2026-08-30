# Mapping a conceptual schema to a store

One conceptual model, two targets. Nothing about the mapping changes what the model
means — and **generating both is a cheap consistency check on the conceptual model**: a
schema that produces an ugly graph *and* an ugly set of tables usually has a modelling
problem, not two mapping problems.

```bash
factum ddl   model.orm.json --dialect postgres|sqlserver|mysql|sqlite|ansi -o schema.sql
factum graph model.orm.json --subtypes nodeTable|absorb -o schema.cypher
```

## Relational (Rmap)

```sql
-- Object type Person
CREATE TABLE "Person" (
    "personNr"    integer      NOT NULL,
    "companyName" varchar(255) NOT NULL,   -- From "... works for ..."
    CONSTRAINT "PK_Person" PRIMARY KEY ("personNr")
);
ALTER TABLE "Person" ADD CONSTRAINT "FK_Person_Company"
    FOREIGN KEY ("companyName") REFERENCES "Company" ("companyName");
```

The functional fact type was **absorbed as a column** rather than becoming a join
table, because its uniqueness constraint made it n:1. The column is `NOT NULL` because
the role was mandatory. **The constraint you drew is the reason the column is what it
is**, and the comment says which fact type it came from.

The rules in full:

- A fact type whose only uniqueness constraint spans **every** role becomes its own
  table with a composite key.
- An **n:1 or 1:1** fact type is absorbed as a column into the table of the object type
  playing the uniquely-constrained role — on the mandatory side for 1:1.
- A **unary** fact type becomes a boolean column.
- **Mandatory** roles produce `NOT NULL`, optional ones `NULL`.
- A **reference mode** expands into its identifying column; compound identifiers expand
  recursively; an object type with no reference scheme gets a surrogate key **plus a
  mapping note** — treat that note as a to-do.
- **Objectified** fact types map to their own table keyed by the objectified roles.
- **Subtypes** are absorbed into the supertype's table with optional columns; an
  exclusive partition adds a discriminator column with a `CHECK`.
- **Value constraints** become `CHECK`; uniqueness becomes `PRIMARY KEY` / `UNIQUE`.

## Property graph (LadybugDB Cypher DDL)

- **An entity type becomes a node table**, keyed by its reference mode, by a
  single-role preferred identifier over a value type, or — failing both — by a generated
  `SERIAL` key plus a mapping note.
- **A value type stays a property** unless it is played many-to-many or in an n-ary fact
  type, where a single-valued property could not hold it. This is the rule a hand-drawn
  graph model gets wrong most often, because *"node or property?"* feels like a style
  question and is actually **decided by the uniqueness constraints**.
- **A binary fact type becomes a relationship table** whose multiplicity is read off the
  uniqueness constraints: one role constrained → `MANY_ONE` / `ONE_MANY`; both →
  `ONE_ONE`; only a spanning constraint → `MANY_MANY`.
- **A unary fact type becomes a `BOOLEAN` property.**
- **An n-ary or objectified fact type is reified into a node**, with one `MANY_ONE`
  relationship per role. Role links to the same player share one relationship table with
  several `FROM … TO …` pairs. Objectify a fact type to name its node yourself.
- **Subtypes get their own label joined by `IS_A`**, or are absorbed with
  `--subtypes absorb` / `orm.graph.subtypeStrategy`.

### What the graph cannot enforce

Mandatory, frequency, ring, set-comparison, cardinality and most value constraints are
emitted as a **trailer of comments**, not as enforced DDL. That is honest accounting,
not a limitation: the constraint is still in the model, still verbalizes, and can be
turned into a validation query. The alternative — silently dropping it — is how a rule
stops existing.

Turn the trailer into checks: each unenforced constraint has a natural Cypher query
that returns the violating rows, and those queries belong in your test suite or a
nightly job.

### Porting to another store

The emitted DDL is Cypher-shaped. For Neo4j, node tables become labels plus
`REQUIRE … IS UNIQUE` / `IS NOT NULL` constraints; a value type absorbed as a property
is untyped unless you add `REQUIRE x.p IS :: STRING`. Memgraph and others sit in
between. The inversion worth knowing: stores without node tables express identity as
*constraints on a label* rather than as a table definition, so the same model produces
more constraint statements and fewer type declarations.

## Steering the mapping with hints

Hints never change what the schema means.

```json
"hints": {
  "relational": { "schemaName": "app", "tableName": "employee",
                  "columnName": "emp_name", "sqlType": "varchar(80)",
                  "mapping": "absorb" | "separateTable" },
  "graph":      { "label": "Employee", "labels": ["Party"],
                  "propertyName": "name", "mapping": "node" | "property" }
}
```

`relational.schemaName` is model-level only. A `graph.mapping: "property"` hint that
would lose facts — a value played many-to-many — is **refused** rather than silently
applied. Unknown hint targets are legal and preserved, so a downstream tool can carry
its own without a format change.

Relevant settings: `orm.ddl.dialect`, `orm.ddl.quoteIdentifiers`,
`orm.graph.subtypeStrategy`, `orm.graph.ifNotExists`.

## Drift

The model and the database diverge. `factum drift` measures the gap:

```bash
factum drift model/domain.orm.json db/schema.sql --dialect postgres --exit-code
```

It reports differences and reconciling statements. In CI, `--exit-code` fails the build
when production has moved on without the model.
