---
description: Plan a schema change: diff the model, measure drift against the database, and stage the migration
argument-hint: [path to .orm.json] [what is changing]
---

Plan the schema change: **$ARGUMENTS**

Use the `factum-orm` skill; load `references/mapping.md` and `references/tooling.md`.

**1. Say what changed, in sentences.** Before touching anything else:

```bash
factum diff <before>.orm.json <after>.orm.json --format markdown
```

A model change is reviewable when it reads as sentences. If I have not made the change
yet, make it in a copy and diff against the original.

**2. Measure the gap between the model and production.**

```bash
factum drift <model>.orm.json <schema.sql> --dialect <dialect>
```

Report what has drifted in each direction: the database has something the model does
not, and the model has something the database does not. Those are different problems.

**3. Notice what the tool did not say.** Drift compares structure. It cannot tell you
that a column now means something different, or that a rule moved into application
code. Ask me about anything the diff touched that looks semantic rather than
structural.

**4. Stage it as expand and contract.** Add the new shape, backfill, move readers,
move writers, then remove the old shape. Say which step each generated statement
belongs to, and which steps are safe to run while the system is live.

**5. Name the constraint the database will not hold.** Every migration has at least
one rule that survives only in the model and the application. List them explicitly so
they end up in the writer or in a check, not in somebody's memory.

**6. Say what happens to the sample population.** If the fact types changed shape, the
sample rows have to change with them, or the model stops being checkable.

Finish with the ordered migration steps, the CI wiring that would have caught this
drift earlier, and anything I need to decide before the first step runs.
