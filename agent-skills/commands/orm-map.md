---
description: Generate the relational and property-graph schemas from a model, and read the mapping notes
argument-hint: [path to .orm.json] [postgres | sqlserver | mysql | sqlite | ansi | graph | both]
---

Map: **$ARGUMENTS**

Use the `factum-orm` skill; load `references/mapping.md`.

Generate **both** targets unless I asked for one. Generating both is a cheap
consistency check on the conceptual model: a schema that produces an ugly graph and an
ugly set of tables usually has a modelling problem, not two mapping problems.

```bash
factum ddl   <model> --dialect <dialect> -o build/schema.sql
factum graph <model> -o build/schema.cypher
```

Then do the part that matters more than the DDL:

1. **Explain each shape from the constraint that caused it.** Why this column is
   `NOT NULL`, why this fact type absorbed instead of becoming a table, why this
   relationship is `ONE_ONE` rather than `MANY_MANY`.
2. **Read the mapping notes out loud.** A surrogate key means an object type has no
   reference scheme, and that is a to-do, not a detail.
3. **List what the target cannot enforce.** For the graph that is most of the
   constraint family. For each one, write the validation query that would catch a
   violation, and say where it should run: a test, a nightly job, or the writer.
4. **Check the hints.** If a hint is doing work a constraint should be doing, say so.

If I name a store the tool does not emit — Neo4j, Memgraph, something else — port the
Cypher by hand using the dialect table in the reference, and be explicit about which
constraints change from enforced to unenforced on the way.
