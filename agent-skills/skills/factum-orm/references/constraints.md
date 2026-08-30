# The eight constraint kinds

Constraints attach to **roles**. Every one carries a modality: `alethic` (default,
*it is necessary that*, enforced) or `deontic` (*it is obligatory that*, deliberately
not enforced so the violation can be recorded).

| Constraint | Scope | Verbalizes as | Relational | Graph |
| --- | --- | --- | --- | --- |
| Uniqueness | roles of one or more fact types | `at most one` / `combination occurs at most once` | `PRIMARY KEY`, `UNIQUE` | multiplicity, primary key |
| Mandatory | one or more roles | `each X … some Y` | `NOT NULL` | comment |
| Frequency | one or more roles | `at least n and at most m times` | comment | comment |
| Ring | two roles of one fact type | `no X is related to itself …` | comment | comment |
| Subset / exclusion / equality | role sequences | `if … then`, `no … both`, `if and only if` | comment | comment |
| Value | object type or role | `the possible values of X are {…}` | `CHECK` | comment + property type |
| Cardinality | object type or role | `the number of Xs is …` | comment | comment |
| Subtype set | a supertype's subtypes | `exactly one of: A or B` | discriminator + `CHECK` | labels / `IS_A` |

So much of the right-hand side saying *comment* is honest accounting, not a
limitation. The constraint is still in the model, still verbalizes, and a validation
query can still check it. What the tool will not do is pretend the store enforces
something it cannot.

## 1. Uniqueness — the one that decides everything downstream

*The combination of values in these roles occurs at most once.*

**The bar covers what is unique.** For a binary there are exactly three cases, and
mixing up the last two is the most common misreading of ORM notation:

| Bars | JSON | Means |
| --- | --- | --- |
| One role | one constraint, `roles: ["works.r0"]` | n:1 — each Person works for at most one Company |
| Both roles, separately | **two** constraints, one role each | 1:1 |
| One bar spanning both | one constraint, `roles: ["has.r0", "has.r1"]` | m:n — only the *pair* is unique |

A spanning bar on a binary is the *weakest* possible uniqueness constraint.

`isPreferredIdentifier: true` marks the constraint that identifies the object type —
it becomes the primary key. A uniqueness constraint whose roles come from several fact
types is **external uniqueness** (drawn as a circled bar); it needs at least two roles.

Every fact type needs one. A fact type without is `missing-uniqueness`, and it asserts
only that the fact is *possible* — the mappers have nothing to work from and an agent
has nothing to rely on.

### The arity check

**For an n-ary fact type, a uniqueness constraint spanning fewer than n−1 roles means
the fact type is splittable.** Halpin's rule, the single most useful test in ORM,
reported as `uniqueness-too-narrow`. The fix is always the same: split.

`Academic of Rank works for Dept` with uniqueness on `Academic` alone spans 1 of 3.
Rank and Dept do not constrain each other, so it is really two binaries.

There is a softer second test the arity rule misses: **read the fact type aloud and
ask whether it is one thought.** `AuditEvent records that Actor performed Action on
Resource` is four thoughts.

## 2. Mandatory

*Every instance of the player plays this role.* The purple dot where the connector
meets the object type.

- **Simple:** `roles: ["works.r0"]` → *It is necessary that each Person works for some
  Company.*
- **Disjunctive:** several roles played by the **same** object type → *each Academic
  participates in at least one of: Academic is tenured or Academic is contracted till
  Date.* Roles played by different object types is `mandatory-player-mismatch`.

Where a role carries both mandatory and uniqueness, the verbalizer merges them into
*exactly one*.

Say the negative out loud for every role: *"not every X does this."* If that sentence
is uncomfortable, draw the dot. A mandatory constraint already implied by a preferred
identifier is the warning `implied-mandatory`.

## 3. Frequency

*Each instance that plays this role does so at least n and at most m times.*
`min` and `max` required; `max: null` is unbounded.

```text
It is necessary that each Panel that plays the constrained role in
"Reviewer sits on Panel" does so at least 3 and at most 5 times.
```

Frequency is about how many times an **instance plays a role**. Cardinality is about
how many instances **exist**. A frequency of exactly 1 is a uniqueness constraint and
is reported as `frequency-is-uniqueness`.

## 4. Ring

Exactly two roles of one fact type, played by the same or compatible object types.
Ten types; several may be combined on one constraint and are joined with *and*.

| Type | Clause |
| --- | --- |
| `irreflexive` | no X is related to itself |
| `reflexive` | each X that plays this fact type is related to itself |
| `purelyReflexive` | — |
| `symmetric` | if one X is related to a second then the second is related to the first |
| `asymmetric` | … then the second is **not** related to the first |
| `antisymmetric` | if two distinct Xs are related then the reverse does not hold |
| `transitive` | first→second and second→third implies first→third |
| `intransitive` / `strictlyIntransitive` | … implies first **not** related to third |
| `acyclic` | no cycle of Xs exists |

`symmetric` with `asymmetric` is `contradictory-ring`. Roles whose players are
unrelated is `ring-incompatible-roles`.

**Use one on every self-relation.** Without it you have asserted that self-reference
and cycles are legal — occasionally right, usually an oversight a graph database will
let you exploit at 3 a.m. `irreflexive + acyclic` is the workhorse pair for
causality, dependency and containment.

## 5. Set-comparison: subset, exclusion, equality

`roleSequences`, at least two, all the same length, pairwise compatible players.

| Kind | Sentence |
| --- | --- |
| `subset` | *if some Person drives some Car then some Person holds some Licence* |
| `exclusion` | *no Academic both … and …* |
| `equality` | *some Person drives some Car if and only if some Person holds some Licence* |

For `subset`, sequence 0 is the subset and sequence 1 the superset; the arrow points
from subset to superset.

Disjunctive mandatory **plus** exclusion over the same two roles is an exclusive-or:
exactly one, never both, never neither. Two marks on a diagram, two sentences a head
of department confirms in five seconds.

Errors: `set-constraint-length` (unequal sequences), `set-constraint-arity` (fewer
than two), `set-constraint-compatibility` (incompatible players).

## 6. Value

Targets exactly one of `objectTypeId` or `roleId`.

```json
{ "id": "vc", "kind": "value", "objectTypeId": "rank",
  "ranges": [{"value": "P"}, {"value": "SL"}, {"value": "L"}] }
{ "id": "vr", "kind": "value", "objectTypeId": "confidence",
  "ranges": [{"min": 0, "max": 1, "minInclusive": true, "maxInclusive": true}] }
```

Verbalizes as *the possible values of Rank are {'P', 'SL', 'L'}* or *{0..1}*. Open
ranges are `{>= a}` / `{<= b}`. Strings are quoted, numbers are not.

**Enumerate every code. Always.** It is the cheapest constraint to add and the one
that pays back most in agent-facing work, because the alternative is a language model
inferring the legal set from whatever rows it happened to see.

## 7. Cardinality

*How many instances exist*, or how many players a role has.

```text
It is necessary that the number of Companies is at most 1.
It is necessary that the number of Agents playing the constrained role is at most 8.
```

## 8. Subtype set

Groups subtype relations under one supertype.

| Flags | Sentence |
| --- | --- |
| `isExclusive` + `isExhaustive` | *each Party is exactly one of: Employee or Contractor* (a partition) |
| `isExclusive` only | *no Party is both Employee and Contractor* |
| `isExhaustive` only | *each Party is at least one of: Employee or Contractor* |

A plain subtype relation on its own verbalizes as *Each Student is a kind of Person.*

## Modality: decide it, do not default it

For each constraint ask: **if this is violated, should the write fail, or should there
be a record of the violation?** The second answer means `deontic`.

Alethic overreach — a rule modelled as necessary that is really obligatory — makes the
system unable to record a legitimate exception. Six months later somebody adds a
nullable `override_reason` column and a code path that skips validation, and the rule
now exists in two places and agrees with itself by luck.

Agents violate obligations; that is what obligations are for. A model that cannot
represent the violation gives you an audit log that quietly omits exactly the events
you built it to catch.
