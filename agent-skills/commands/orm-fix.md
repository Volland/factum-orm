---
description: Repair the validator errors in an ORM 2 model, one code at a time
argument-hint: [path to .orm.json]
---

Fix the validation problems in: **$ARGUMENTS**

Use the `factum-orm` skill; `references/validation.md` maps every code to its
mechanical fix.

Work like this:

1. Run the validator and quote the real output. Never invent a message.
2. Group the problems by code. Fix the **structural** ones first (dangling ids, bad
   readings, empty constraints) — they are usually hand-editing damage and the fixes
   are unambiguous.
3. For **elementarity** errors, stop and think before editing:
   - `missing-uniqueness` is a question, not a defect. Ask me what the answer is. If
     the answer really is "any number of times", draw the spanning bar and say so.
   - `uniqueness-too-narrow` always means split. Show me the two or three fact types
     you propose, as sentences, before you write them.
4. For **population** errors, do not guess. Either the constraint is too strong or the
   data is bad; tell me which you think it is and why, and let me decide.
5. Re-validate after each group and show the output shrinking.

When you are done: re-run the validator, print the final output, and show me a diff of
the verbalization — what the model said before, and what it says now. If `factum` is
installed, use `factum diff <before> <after> --format markdown` for that.

Do not silently drop a constraint to make an error go away.
