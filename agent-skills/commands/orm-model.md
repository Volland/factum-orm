---
description: Build an ORM 2 model from real examples, following the seven-step design procedure
argument-hint: [domain, file, or table to model]
---

Run Halpin's Conceptual Schema Design Procedure with me on: **$ARGUMENTS**

Use the `factum-orm` skill and load `references/csdp.md` before you start.

Work the seven steps **in order**, and stop at the end of each one to show me what
you have and get a yes or no. Do not skip ahead; do not add a constraint I have not
confirmed.

1. **Verbalize familiar examples.** If I have not given you real data — a table, a
   CSV, a screen, a JSON payload — ask for it before naming a single object type.
   Turn each cell into a sentence with a real value in it.
2. **Draw the fact types, populated, with no constraints.** Write the `.orm.json`,
   put my rows in as populations, and run the checker. The `missing-uniqueness`
   errors at this stage are expected; say so.
3. **Check for splittability.** Apply the arity check to every n-ary, then read each
   fact type aloud and tell me which ones are more than one thought.
4. **Uniqueness constraints**, then re-check arity.
5. **Mandatory roles.** For each role, say the negative out loud: *"not every X does
   this."* Ask me about every one that sounds wrong. Then look for value types doing
   an entity's job.
6. **Value, set-comparison, subtype and ring constraints.** Do not stop early here —
   these are the rules nothing else in my stack will ever state.
7. **Check the whole schema.** Validate, then read the full verbalization back to me
   as sentences.

Throughout: propose each constraint as **the FORML sentence it produces**, and ask me
to confirm or reject the sentence rather than the diagram. Where a rule is one I could
legitimately break, ask whether it should be deontic.

Finish with the model file, its verbalization, and a list of anything I said I would
check with someone else.
