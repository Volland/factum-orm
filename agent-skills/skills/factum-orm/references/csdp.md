# The Conceptual Schema Design Procedure, worked

Halpin's seven steps. **The order is load-bearing** — most bad ORM models are the
result of doing step 4 before step 3. The procedure is tool-independent; it was done
on paper for twenty years. The commands below just make the intermediate states
checkable rather than asserted.

Run it as a conversation. At each step, state what you have as sentences and ask the
user to confirm or reject.

---

## Step 1 — Verbalize familiar examples

Start from data somebody recognises: a table, a screen, a spreadsheet, a report.
**Not a requirements document.**

```text
EmpNr  EmpName   Dept       Room  Rank  Tenured  ContractEnd
101    Adams     Computing  A-12  P     yes      —
102    Brown     Computing  A-14  SL    no       2027-06-30
103    Cheng     Physics    B-03  L     no       2026-12-31
```

Say what each cell means, as a sentence with a real value in it:

```text
The Academic with EmpNr 101 has EmpName 'Adams'.
The Academic with EmpNr 101 works for the Dept named 'Computing'.
The Academic with EmpNr 101 has the Rank coded 'P'.
The Academic with EmpNr 101 is tenured.
The Academic with EmpNr 102 is contracted till 2027-06-30.
```

This feels trivial and is not. Two things happen here and nowhere else. You find out
what the columns *mean*, which is frequently not what they are called. And you find
the elementary units — notice `Tenured` and `ContractEnd` became two fact types, a
unary and a binary, not one nullable pair.

From a CSV, `factum derive staff.csv --name Academic -o staff.orm.json` does the
mechanical part: one binary per column, an identifying column promoted to a reference
mode, inferred types and enumerations, every row kept as a sample fact, and notes to
confirm. What it will not do is decide that a column is really about something else.

**This step is the bottleneck, and it is a social problem.** Getting real examples out
of people is harder than modelling them. The trick that works: **bring a wrong model.**
People who cannot tell you the rule will correct a rule you state badly, immediately
and precisely. That is the entire reason verbalization exists.

## Step 2 — Draw the fact types, populated

Draw them all. **No constraints yet.** Put the step-1 rows in as populations.

The validator will now complain once per fact type with `missing-uniqueness`. That is
correct and expected: the model currently asserts only *these facts are possible*.

Constraints depend on the *set* of fact types — you cannot tell whether a uniqueness
constraint is too narrow until you can see what else competes for the same roles.

## Step 3 — Check for splittability

For every fact type with three or more roles: can I split this without losing
information?

The mechanical test is the arity check — **a uniqueness constraint spanning fewer than
n−1 roles means split it** (`uniqueness-too-narrow`). The softer test catches what the
rule does not: **read it aloud and ask whether it is one thought.** `Academic of Rank
works for Dept` is two thoughts. `AuditEvent records that Actor performed Action on
Resource` is four.

**This is where domain knowledge lives.** No tool can tell you the audit event is
really four facts, because that is a claim about the world. The validator gets you to
*this is splittable*; deciding *how* is the modeller's job.

## Step 4 — Uniqueness constraints, then re-check arity

For each fact type: what combination of roles occurs at most once?

- `Academic has EmpName` — one name each, names unique here → two bars, separately (1:1)
- `Academic works for Dept` — one dept each → bar on the Academic role (n:1)
- `Academic occupies Room` — one room each, a room may hold several → bar on Academic
- `Academic is tenured` — a unary, the bar covers its single role

The step ends with "re-check arity" for a reason: adding a uniqueness constraint can
*reveal* that a fact type was splittable. Skipping this loop is why compound n-aries
survive into production schemas.

## Step 5 — Mandatory roles, and the entity types you forgot

For each role: does every instance of the player play it? Say the negative out loud —
*"not every academic has a room"* — and if that is uncomfortable, draw the dot.

- Every academic has a name, a dept, a rank → **mandatory**
- Not every academic has a room → **optional**, and that is now an assertion
- Neither tenure nor contract end is individually mandatory, but every academic has one
  or the other → **disjunctive mandatory** over the two roles

That last one would have been lost entirely in a table design — two nullable columns
and a comment, at best.

The second half of the step: look for value types doing an entity's job. `Dept` as an
entity type with a name pays for itself the moment departments acquire heads, budgets
and parent faculties.

## Step 6 — Value, set-comparison, subtype and the rest

- `Rank` takes one of three codes → **value constraint** `{'P', 'SL', 'L'}`
- An academic cannot be both tenured and contracted → **exclusion** over the two roles

Combined with step 5's disjunctive mandatory, that exclusion gives an exclusive-or:
exactly one, never both, never neither. A real business rule, two marks on a diagram,
two sentences confirmable in five seconds.

**This is where models get abandoned.** By now the schema works well enough and the
rest feels like polish. It is not: set-comparison and ring constraints are exactly the
ones no other artifact in the stack will ever state, and therefore the ones with the
highest marginal value. Finish the step.

## Step 7 — Check the whole schema

Three checks; a tool does two.

**Redundancy.** Is any fact type derivable from the others? Any constraint implied by
another? `redundant-spanning-uniqueness` and `implied-mandatory` cover the common
cases.

**Consistency.** Run the validator. `No problems found. 20 sample fact(s).`

**Against the examples.** The check that catches the constraint you drew because it
looked right rather than because it was. Put the step-1 rows in as a population and
the validator checks the constraints against them. This is the only category of error
that can tell you the model is *wrong* rather than merely ill-formed.

Then read the verbalization end to end. That is the artifact you hand a domain expert,
and the artifact you hand an agent:

```text
## Rank
- It is necessary that the possible values of Rank are {'P', 'SL', 'L'}.

## Academic works for Dept
- It is possible that some Academic works for some Dept.
- Each Academic works for exactly one Dept.

## External constraints
- It is necessary that each Academic participates in at least one of:
  Academic is tenured or Academic is contracted till Date.
- It is necessary that no Academic both some Academic is tenured
  and some Academic is contracted till some Date.
```

Eighteen sentences for this domain. The equivalent DDL is longer and says a third as
much.

## The procedure in an agentic loop

The seven steps map onto an agent loop almost directly:

1. `factum derive` on a real export → draft model
2. Agent reads `verbalize_model`, proposes splits and constraints
3. `validate_model` refuses anything incoherent
4. `read_population` checks the proposal against the real rows
5. The human reads the diff — **as sentences** — and approves or rejects

The human stays in the loop at the only steps where a human is irreplaceable: step 1,
and the judgement calls in step 3. Everything else the tooling carries.
