# FORML — what a model verbalizes to

FORML is the controlled English ORM constraints verbalize into. **It is generated,
never authored.** Its value is that a domain expert can confirm or reject a sentence
without knowing the notation, and that an agent reading the sentences gets the rules
rather than the storage layout.

`factum verbalize model.orm.json [--mode forml|plain] [--population]`

## Reference schemes

```text
Each Person has exactly one PersonNr; each PersonNr refers to at most one Person.
```

Emitted for every entity type with a reference mode.

## Fact types

| Model content | Sentence |
| --- | --- |
| Any fact type | `It is possible that some Person works for some Company.` |
| Uniqueness on role 0 | `Each Person works for at most one Company.` |
| Uniqueness + mandatory on role 0 | `Each Person works for exactly one Company.` |
| Uniqueness on a unary's role | `Each Academic is tenured at most once.` |
| Uniqueness spanning every role | `In each population of "Person has Skill", each Person, Skill combination occurs at most once.` |
| Uniqueness spanning k of n roles | `For each Room and Day, at most one Employee is related in "Employee booked Room on Day".` |
| Uniqueness where no reading starts at the constrained role | `Each EmpName is related to at most one Academic in "Academic has EmpName".` |
| External uniqueness | `It is necessary that each combination of Promise and Agent refers to at most one Assessment.` |

## Mandatory

| Model content | Sentence |
| --- | --- |
| Simple | `It is necessary that each Person works for some Company.` |
| Disjunctive | `It is necessary that each Academic participates in at least one of: Academic is tenured or Academic is contracted till Date.` |

Where a role carries both mandatory and uniqueness the two merge into `exactly one` on
the fact type's own line, rather than being emitted separately.

## Frequency

```text
It is necessary that each Panel that plays the constrained role in
"Reviewer sits on Panel" does so at least 3 and at most 5 times.
```

## Ring

Each type contributes a clause; several are joined with `and`.

| Type | Clause |
| --- | --- |
| `irreflexive` | `no X is related to itself in "P"` |
| `acyclic` | `no cycle of Xs exists in "P"` |
| `symmetric` | `if one X is related to a second in "P" then the second is related to the first` |
| `asymmetric` | `… then the second is not related to the first` |
| `transitive` | `if a first X is related to a second and the second to a third in "P" then the first is related to the third` |
| `intransitive` | `… then the first is not related to the third` |
| `reflexive` | `each X that plays this fact type is related to itself in "P"` |
| `antisymmetric` | `if two distinct Xs are related in "P" then the reverse does not hold` |

```text
It is necessary that no Episode is related to itself in "Episode leads to Episode"
and no cycle of Episodes exists in "Episode leads to Episode".
```

## Set comparison

| Kind | Sentence |
| --- | --- |
| Subset | `It is necessary that if some Person drives some Car then some Person holds some Licence.` |
| Exclusion | `It is necessary that no Academic both some Academic is tenured and some Academic is contracted till some Date.` |
| Equality | `It is necessary that some Person drives some Car if and only if some Person holds some Licence.` |

The exclusion form names the players common to both sequences, which is why it reads
`no Academic both … and …`. The sentence is awkward and is quoted here exactly as the
verbalizer emits it.

## Value

| Target | Sentence |
| --- | --- |
| Object type, discrete | `It is necessary that the possible values of Rank are {'P', 'SL', 'L'}.` |
| Object type, range | `It is necessary that the possible values of Confidence are {0..1}.` |
| Role | `It is necessary that the Amount playing the constrained role in "Spend has Amount" must be {0..1000}.` |

Range syntax: `{a..b}` bounded, `{>= a}` and `{<= b}` open. Strings quoted, numbers not.

## Cardinality

```text
It is necessary that the number of Companies is at most 1.
It is necessary that the number of Agents playing the constrained role is at most 8.
```

## Objectification

```text
Each Teaching objectifies exactly one "Academic teaches Subject" fact.
```

## Subtyping

| Model content | Sentence |
| --- | --- |
| A subtype relation | `Each Student is a kind of Person.` |
| Exclusive + exhaustive | `It is necessary that each Party is exactly one of: Employee or Contractor.` |
| Exclusive only | `It is necessary that no Party is both Employee and Contractor.` |
| Exhaustive only | `It is necessary that each Party is at least one of: Employee or Contractor.` |

## Modality

| Modality | Prefix |
| --- | --- |
| `alethic`, `forml` mode (default) | `It is necessary that ` |
| `alethic`, `plain` mode | *(none)* |
| `deontic` | `It is obligatory that ` |

`plain` drops the alethic prefix and keeps the deontic one, so the two stay
distinguishable — but the sentence loses the explicit statement of necessity, which is
why **`forml` is the right mode for anything an agent reads.**

## Sample population

With `--population`, values are substituted back through the primary reading:

```text
## Sample population

- 101 works for Acme
- 102 works for Acme
- 103 works for Globex
```

## The shape of the output

`factum verbalize` emits Markdown:

1. `# <model name> — verbalization`
2. A `##` section per object type: its reference-scheme sentence, plus any value or
   cardinality constraint on it.
3. A `##` section per fact type: the existential sentence, uniqueness and mandatory
   sentences, and the objectification sentence if any.
4. `## External constraints` — everything spanning fact types: set-comparison
   constraints, external uniqueness, disjunctive mandatory, subtype sets.
5. `## Sample population`, with `--population`.

The section structure is stable, which makes it straightforward to diff and to chunk.
