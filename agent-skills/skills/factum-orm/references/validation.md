# Validation codes and their mechanical fixes

Codes are stable and greppable, and each maps to a mechanical fix. Errors block
`apply_model` and fail a build; warnings do not unless `--strict`.

```bash
factum validate model.orm.json [--strict] [--format text|json|github]
node scripts/check-model.mjs model.orm.json        # offline, no install needed
```

Exit codes: `0` success, `1` blocking errors (or something to report with
`--exit-code`), `2` the input could not be read or parsed.

## Structural — the model does not hold together

Almost always a mid-edit state or the result of hand-editing. All errors.

| Code | Meaning |
| --- | --- |
| `unnamed-object-type` | An object type with no name |
| `duplicate-object-type-name` | Two object types share a name |
| `unattached-role` | A role box with no player |
| `dangling-role-player` | A role references an object type that does not exist |
| `dangling-constraint-role` | A constraint references a role that does not exist |
| `dangling-value-constraint` | A value constraint targets something that does not exist |
| `untargeted-value-constraint` | A value constraint targets neither an object type nor a role |
| `dangling-subtype` | A subtype relation references a missing object type |
| `dangling-subtype-set` | A subtype set references a missing subtype relation |
| `dangling-objectification` | An entity type objectifies a fact type that does not exist |
| `empty-fact-type` | A fact type with no roles |
| `empty-constraint` | A constraint with no roles |
| `empty-ring` | A ring constraint with no ring types |
| `empty-value-constraint` | A value constraint with no ranges |
| `no-reading` | A fact type with no reading |

## Identification — the model cannot say what a thing is

| Code | Severity | Meaning | Fix |
| --- | --- | --- | --- |
| `no-reference-scheme` | error | An entity type with no reference mode and no preferred identifier | Give it a reference mode, or a preferred-identifier uniqueness constraint |
| `value-type-ref-mode` | warning | A value type carrying a reference mode | Value types identify themselves; remove it, or make it an entity type |
| `ambiguous-identification-path` | warning | A subtype with several possible identification paths | Mark one `isPreferredIdentificationPath` |
| `multiple-objectification` | error | One fact type objectified by several entity types | Keep one |

## Elementarity — the model says the wrong number of things

The three most instructive codes in the list.

| Code | Severity | Meaning | Fix |
| --- | --- | --- | --- |
| `missing-uniqueness` | error | A fact type with no uniqueness constraint | Decide. If it really is many-to-many, draw the spanning bar |
| `uniqueness-too-narrow` | error | A uniqueness constraint spanning fewer than n−1 roles | Split the fact type |
| `redundant-spanning-uniqueness` | warning | A spanning constraint made redundant by a narrower one | Remove the spanning one |
| `implied-mandatory` | warning | A mandatory constraint already implied by a preferred identifier | Remove it |

```text
error   uniqueness-too-narrow   An internal uniqueness constraint on
"Academic of Rank works for Dept" spans 1 of 3 roles. It must span at least 2;
otherwise the fact type is not elementary and should be split.
```

This is the error you will hit most often, and the fix is always the same: split it.

## Readings

| Code | Meaning |
| --- | --- |
| `reading-arity-mismatch` | A reading whose `roleOrder` length does not match the arity |
| `reading-placeholder-range` | A `{n}` placeholder outside the range of `roleOrder` |
| `reading-role-order` | A `roleOrder` that does not name the fact type's roles |

Usually the result of adding a role and forgetting to update a reading.

## Constraint compatibility

| Code | Severity | Meaning |
| --- | --- | --- |
| `contradictory-ring` | error | Ring types that cannot hold together: `symmetric` with `asymmetric` |
| `ring-incompatible-roles` | error | A ring over roles whose players are not the same or compatible |
| `set-constraint-length` | error | Role sequences of different lengths |
| `set-constraint-arity` | error | Fewer than two role sequences |
| `set-constraint-compatibility` | error | Role sequences whose players are not pairwise compatible |
| `external-uniqueness-unary` | error | An external uniqueness constraint over a single role |
| `bad-frequency-range` | error | Min exceeds max, or is negative |
| `bad-cardinality-range` | error | An impossible range |
| `frequency-is-uniqueness` | warning | A frequency of exactly one, which is a uniqueness constraint |
| `mandatory-player-mismatch` | error | A disjunctive mandatory over roles played by different object types |

## Subtyping

| Code | Meaning |
| --- | --- |
| `self-subtype` | An object type that is its own subtype |
| `subtype-cycle` | A cycle in the subtype graph |
| `subtype-kind-mismatch` | A subtype relation between an entity type and a value type |
| `subtype-set-mismatch` | A subtype set whose relations do not share a supertype |

## Population — the constraints disagree with your examples

The only category that can tell you the model is **wrong** rather than merely
ill-formed. All errors.

| Code | Meaning |
| --- | --- |
| `population-arity` | A sample tuple whose value count does not match the arity |
| `population-violates-uniqueness` | Two rows repeat a value the uniqueness constraint forbids |
| `population-violates-mandatory` | An instance that plays no role where the role is mandatory |
| `population-violates-frequency` | A value occurring more or fewer times than allowed |
| `population-violates-value` | A sample value outside the value constraint's ranges |

```text
error   population-violates-uniqueness   Rows 1 and 4 of "Person works for Company"
                                          repeat 101, which the uniqueness
                                          constraint forbids.
```

When you see one of these, one of two things is true: **the constraint is too strong,
or the data is bad.** Do not guess which. That is a domain question, and it is exactly
the question worth putting to a domain expert.

## Hygiene

| Code | Severity | Meaning |
| --- | --- | --- |
| `unused-object-type` | warning | An object type that plays no role and has no subtypes |

Often a leftover, occasionally a genuine independent type about to acquire facts.

## Working with the codes

- **In CI**, `--strict` promotes warnings to failures. Right for a finished model,
  wrong for one still being drafted.
- **In the editor**, `orm.validation.enabled` turns Problems-panel reporting off. Use
  it during a large refactor, then turn it back on.
- **For an agent**, the code is the useful part of the message. `apply_model` returns
  them verbatim when it refuses a write, which is why an agent usually recovers from a
  rejection in one turn.
