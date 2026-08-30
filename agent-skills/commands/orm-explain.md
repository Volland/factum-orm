---
description: Explain an ORM 2, FORML or fact-based modelling concept with a worked example from the book
argument-hint: [concept, notation mark, validator code, or question]
---

Explain: **$ARGUMENTS**

Use the `factum-orm` skill. `references/book-map.md` says which chapter covers what,
and ends with the vocabulary worth using precisely.

Answer in this shape:

1. **The idea, in two or three sentences.** Use the book's vocabulary precisely —
   alethic and deontic, arity and the arity check, entity type and value type,
   frequency and cardinality, exclusive and exhaustive, internal and external
   uniqueness. Precision here is the whole point of the formalism.
2. **A worked example.** Take one from `assets/examples/` where there is one, and say
   which. Show the model fragment, the FORML sentence it produces, and the diagram
   marks. If no bundled model fits, write a small one and check it.
3. **What it changes downstream.** What the relational mapping does with it, what the
   graph mapping does with it, and what an agent reading the verbalization can do that
   it could not before.
4. **The failure mode.** What goes wrong when this is got wrong or left out, stated as
   a concrete situation rather than a principle.
5. **Where to read more** — the chapter or appendix, by name.

If I asked about a validator code, lead with the mechanical fix and then explain why
the rule exists. If I asked "why does ORM do X this way", answer the design question
honestly, including where the notation has a real limitation.
