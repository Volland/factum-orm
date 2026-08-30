# The promise graph

Promise Theory (Burgess) coordinates autonomous agents through voluntary bilateral
promises rather than commands. As a conceptual schema it is small, and every constraint
in it removes a class of unrepresentable situation.

Models: `assets/examples/fig-promise-core.orm.json`, `fig-promise-lifecycle.orm.json`,
`fig-promise-assessment.orm.json`, `fig-promise-full.orm.json` (54 sample facts,
validates clean).

## The five principles, and what each costs you in a schema

| Principle | Schema consequence |
| --- | --- |
| **Autonomy** — no agent promises on another's behalf | `Promise is made by Agent` is mandatory and functional; the promiser is not optional |
| **Voluntary cooperation** | A promise has a status including `rejected`; refusal is a first-class state |
| **Bilateral** — promises must lock together | `Promise is made to Agent` is separate from `is made by`; two promises form a lock |
| **Assessment over enforcement** | `Assessment` is its own entity type, made *by* an agent, with a stance |
| **Local knowledge** | Nothing in the schema is global; every fact is about an agent's own view |

## The promise itself

```text
Each Promise is made by exactly one Agent.
Each Promise is made to exactly one Agent.
Each Promise promises exactly one PromiseBody.
```

Three facts, all mandatory, all functional — the whole of Burgess's definition. Three
separate binaries rather than one ternary is deliberate: promiser, promisee and body do
not constrain each other, so a ternary would fail the arity check.

Note what the model refuses. There is no promise without a promiser — the schema-level
statement of autonomy. **If you find yourself wanting `Promise is made by at most one
Agent`, you are trying to model a command.**

## The lifecycle

```text
Each Promise is of exactly one PromiseKind.
It is necessary that the possible values of PromiseKind are {'+', '-'}.
Each Promise is in exactly one PromiseStatus.
It is necessary that the possible values of PromiseStatus are
  {'offered', 'accepted', 'rejected', 'kept', 'broken'}.
Each Promise is due by at most one Deadline.
It is necessary that no Promise is related to itself in "Promise depends on Promise"
  and no cycle of Promises exists in "Promise depends on Promise".
```

**`PromiseKind` is `+` or `-`.** A `+` promise offers behaviour (*I will respond within
10 ms*); a `-` promise accepts behaviour (*I will use what you send me*). Coordination
requires both. A service that promises to respond and a client that has not promised to
accept the response is not coordinated — it is one agent shouting. Two values, one value
constraint, and the missing half becomes visible.

**Status includes `rejected`.** The most consequential single decision in the schema,
and it is one line. A rejected promise is often the most informative node in the graph:

```text
Promise p1: made by A, to B, body "deliver report in format X", status: broken
Promise p2: made by B, to A, body "process report in format X", status: rejected
```

The root cause is legible — A over-promised, B correctly declined, and the counter-offer
is recorded rather than lost. **If you drop rejections you cannot do causal analysis.
The refusal is the evidence.**

**Dependency is a ring** — `irreflexive`, `acyclic`. This is what makes cascade analysis
possible: when a promise breaks, the promises that depended on it are the blast radius,
and traversing that requires acyclicity. It also catches the deadlock a scheduler would
otherwise discover at runtime.

## The exchange

A promise is rarely alone. An offer is answered, the answer is accepted or refused, a
counter-offer is made, and the whole thing succeeds or fails as a unit.

```text
Each Promise responds to at most one Promise.
It is necessary that no Promise is related to itself in "Promise responds to Promise"
  and no cycle of Promises exists in "Promise responds to Promise".
```

Without `responds to`, a rejection and the promise it refused are two rows with no
relationship, and the only way to pair them is to guess from the agent ids.

`Promise belongs to PromiseExchange` groups an offer, its answers and any counter-offers
so that *did this negotiation succeed* is a question about one object rather than a join
nobody can validate.

## Status is a history, not a field

A stored field cannot answer *when did this become broken*, which is the first question
in every incident review.

```text
Each PromiseStatusEvent concerns exactly one Promise.
Each PromiseStatusEvent records exactly one PromiseStatus.
Each PromiseStatusEvent occurred at exactly one Instant.
It is necessary that each combination of Promise and Instant refers to at most
  one PromiseStatusEvent.          (preferred identifier)
```

A composite reference scheme, no surrogate key. The current status becomes derived:

```text
Promise is in PromiseStatus is derived and stored. Derivation rule: Promise is
in PromiseStatus where PromiseStatus is recorded by the PromiseStatusEvent
concerning that Promise with the latest Instant.
```

Derived **and stored**, because the current status is read on every hop of a traversal.
The derivation rule is what stops the stored copy and the history from disagreeing
silently: it says, in one sentence a reviewer can check, which one is the source.

## Assessment

Promise Theory replaces enforcement with assessment, and the schema has to make room for
assessments that disagree.

```text
Each Assessment assesses exactly one Promise.
Each Assessment is made by exactly one Agent.
Each Assessment gives exactly one Verdict.
Each Assessment is made as exactly one AssessorStance.
It is necessary that the possible values of AssessorStance are {'self', 'witness'}.
It is necessary that the possible values of Verdict are
  {'kept', 'broken', 'partial', 'unknown'}.
Each Outcome realises exactly one Promise.
It is necessary that each combination of Promise and Agent
  refers to at most one Assessment.
```

**Self and witness.** Both are needed, and **their disagreement is data, not noise.** An
agent reporting success on a promise a witness assessed as broken is either mistaken
about its own behaviour or reporting optimistically. Either is worth knowing, and
neither is representable if you store one verdict per promise.

The external uniqueness over the `Promise` and `Agent` roles says one assessment per
assessor per promise: you may hold a view, and you may revise it, but not two at once.

**Assessments are revised, not overwritten.**

```text
Each Assessment supersedes at most one Assessment.
Each Assessment is related to at most one Assessment in
  "Assessment supersedes Assessment".
```

An agent that assessed its own promise `partial` at nine and `broken` at ten has told
you something. **A changed mind is evidence** — a reputation system built on final
verdicts alone cannot distinguish an agent that was wrong once from an agent that is
wrong constantly and corrects itself late.

**`Verdict` includes `partial` and `unknown`** because they happen. A promise to
summarise ten documents that summarised seven is `partial`. Collapsing `unknown` into
`broken` is how reputation systems acquire a systematic bias against agents doing
unobservable work.
