---
description: Review an ORM 2 model against the validator, the anti-patterns and the pre-commit checklist
argument-hint: [path to .orm.json, or a directory of models]
---

Review: **$ARGUMENTS**

Use the `factum-orm` skill; load `references/practices.md` and
`references/validation.md`.

Do all four passes and report them separately.

**1. Mechanical.** Run `factum validate --strict` if available, otherwise
`node scripts/check-model.mjs <model> --strict`. Quote the real output. For each code,
give the mechanical fix from the reference.

**2. Anti-patterns.** Check for all six by name, and say which are absent as well as
which are present:
attribute in disguise, unconstrained fact type, compound n-ary, optional-by-accident
role, alethic overreach, unpopulated fact type.

**3. The checklist.** Go through it line by line, marking each item pass, fail or
"needs a human":

- [ ] Validates clean, or every warning is understood
- [ ] Every fact type has a uniqueness constraint
- [ ] Every role's mandatory status was decided, not defaulted
- [ ] Every self-relation has a ring constraint
- [ ] Every enumerated value type has a value constraint
- [ ] Every rule agents can legitimately break is deontic
- [ ] Every fact type has at least one sample fact
- [ ] The verbalization reads as sentences a domain expert would say
- [ ] Both mappings produce something you would ship
- [ ] The mapping notes contain no surprises

**4. Read it aloud.** Print the verbalization and flag every sentence that a domain
expert would find odd, ambiguous or wrong. This pass catches what the other three
cannot.

Rank the findings: blocking, worth fixing, and worth a conversation. Do not fix
anything unless I ask.
