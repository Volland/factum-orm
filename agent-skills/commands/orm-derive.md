---
description: Draft a first ORM 2 model from a CSV, a SQL schema, a JSON payload or an existing codebase
argument-hint: [path to CSV, DDL, JSON, or a module to read]
---

Produce a **first draft** ORM 2 model from: **$ARGUMENTS**

Use the `factum-orm` skill.

If the input is a CSV and `factum` is installed, start with
`factum derive <file> --name <EntityName> -o draft.orm.json` and work from its output
and its notes. Otherwise build the draft yourself, following the same shape: one
binary fact type per column or field, an identifying column promoted to a reference
mode, inferred data types, enumerations proposed as value constraints, and **every
real row kept as a sample fact**.

Then do the part no derivation tool can do, and be explicit that this is where the
judgement is:

- **Which columns are really about something else.** A column that needs facts of its
  own is an entity type, not a value type. Say which ones you suspect and why.
- **Which fact types are more than one thought.** Apply the arity check; read each one
  aloud.
- **Which nullable columns were undiscussed rules.** Every nullable column is a
  question for me: is it genuinely optional, or has nobody ever decided?
- **Which codes have a fixed legal set** that should become a value constraint.

Validate the draft, then hand me:

1. The model file.
2. Its verbalization, as sentences.
3. A numbered list of the decisions you made that I need to confirm, and the ones you
   could not make without me.

Do not present the draft as finished. A derived model is a starting point for step 3
of the design procedure, not the end of step 7.
