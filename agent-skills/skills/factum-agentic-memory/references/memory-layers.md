# The six memory layers

Six layers, each a small ORM 2 schema, all mapping to one graph. Read bottom-up. The
layering follows *Metagraph for AI Agents*; what ORM adds is that each layer's rules
become explicit and checkable.

Models: `assets/examples/fig-memory-entity.orm.json`, `fig-memory-episodic.orm.json`,
`fig-memory-epistemic.orm.json`, `fig-memory-promise-join.orm.json`.

## L0 / L1 — entity and semantic memory

The least interesting layers and the most often got wrong.

```text
Each MemoryEntity has exactly one Label.
Each MemoryEntity is of exactly one EntityKind.
It is necessary that the possible values of EntityKind are
  {'agent', 'artifact', 'place', 'concept'}.
In each population of "MemoryEntity instantiates Schema",
  each MemoryEntity, Schema combination occurs at most once.
In each population of "Schema declares Slot",
  each Schema, Slot combination occurs at most once.
```

**`EntityKind` is enumerated.** Four values, stated. The alternative — a free-text
`type` field — produces `agent`, `Agent`, `AGENT` and `ai_agent` within a month.

**Instantiation is many-to-many.** An entity may instantiate several schemas: a
`Person` is also a `Stakeholder` is also a `MeetingParticipant`. Modelling it as
functional is the mistake that forces a schema hierarchy later.

**`Schema` and `Slot` are entity types, not strings.** A slot has a name, and eventually
a type, a default and a cardinality. It was always going to be a thing.

`Schema` is *semantic* — a decontextualised concept. Everything in the next layer is
*episodic* and carries a timestamp. Keeping that split visible in the schema is what
stops semantic facts from acquiring timestamps and episodes from being treated as
general knowledge.

## L2 / L3 — episodic memory and causality

Where objectification earns its place.

```text
Each Participation objectifies exactly one
  "Episode involves MemoryEntity as ParticipantRole" fact.
In each population of "Episode involves MemoryEntity as ParticipantRole",
  each Episode, MemoryEntity, ParticipantRole combination occurs at most once.
Each Episode occurred at exactly one Instant.
In each population of "Episode leads to Episode",
  each Episode, Episode combination occurs at most once.
It is necessary that no Episode is related to itself in "Episode leads to Episode"
  and no cycle of Episodes exists in "Episode leads to Episode".
Each Participation has at most one Salience.
```

**The ternary is the right shape.** `Episode involves MemoryEntity as ParticipantRole`
is not splittable: knowing an episode involved Alice, and that it involved someone in
the role of *reviewer*, does not tell you Alice was the reviewer. Its uniqueness
constraint spans all three roles — at least n−1 — so the arity check is satisfied.
Split it into two binaries and you lose the association, which is exactly the bug in
memory systems that store `episode.participants` as a list.

**Participation is objectified because it needs a property.** A salience weight is a
fact about *this participation* — Alice's involvement was highly salient, Bob's was
incidental — and there is nowhere else to put it.

**Causality is a ring constraint.** `Episode leads to Episode`, `irreflexive` and
`acyclic`: nothing causes itself, no causal loops. Without them a causal traversal does
not terminate. This is the clearest example of a rule that exists nowhere else in a
typical stack — not in the graph schema, because graph schemas cannot say it; not in
the retrieval code, because the retrieval code assumes it; only in the heads of the two
people who designed the system, until they leave.

## L4 — epistemology

The layer that separates a memory system from a fact store. Ontology says what the
world is like; epistemology says how we came to believe it.

```text
Each Support objectifies exactly one "Source supports Claim" fact.
Each Belief is about exactly one Claim.
In each population of "Source supports Claim",
  each Source, Claim combination occurs at most once.
Each Support carries exactly one Confidence.
Each Support was observed at exactly one Instant.
It is necessary that the possible values of Confidence are {0..1}.
Each Belief was derived by at most one DerivationMethod.
In each population of "Claim contradicts Claim",
  each Claim, Claim combination occurs at most once.
It is necessary that no Claim is related to itself in "Claim contradicts Claim"
  and if one Claim is related to a second in "Claim contradicts Claim"
  then the second is related to the first.
```

**Belief and Claim are separate.** A claim is a proposition; a belief is this agent's
stance toward it. Two agents can hold different beliefs about the same claim, and
merging them is a real operation. Systems that conflate the two cannot represent
disagreement — which is the situation this layer exists for.

**Support is objectified.** `Source supports Claim` needs a confidence and a timestamp.
You can put a confidence on an edge, but you cannot then say *when* it was assigned or
by which method, because the confidence is not something you can point at. Two sources
supporting the same claim produce two `Support` instances with two confidences, which is
what makes cross-source aggregation expressible at all.

**Confidence is bounded** — `{0..1}`, a `CHECK` in SQL. The number of systems storing a
confidence of `1.7` because one code path used percentages is not small.

**Contradiction is a symmetric, irreflexive ring.** If A contradicts B then B
contradicts A, and nothing contradicts itself. The traversal that finds conflicts need
not try both directions, and a stored one-way contradiction becomes a detectable bug.

### The Map and the Mirror

Easy to build only half of.

- Only the **Map** (L0–L3, what the world is like): cannot resolve conflicting sources,
  cannot decay a stale belief, cannot explain why it thinks what it thinks. Confidently
  wrong.
- Only the **Mirror** (provenance and confidence with no committed beliefs): never acts.
  Every question returns a distribution.

You need both, and they belong in one schema because the interesting queries cross the
boundary: *which of my high-confidence beliefs are supported only by sources I have
since stopped trusting?*

## L5 — meta-cognition

The thinnest and least settled layer; the book ships no model for it. What belongs
there is patterns over episodes: *tasks of this shape usually take three attempts*,
*this source is reliable about pricing and not about availability*. Structurally it is
the same move one level up — a fact about a set of facts — and the mechanism is the
same: objectify, then constrain. If you build it, the discipline from the layers below
applies unchanged: enumerate the kinds, bound the scores, ring-constrain the
self-relations, and populate every fact type with a real example before believing it
exists.

## Semantic Spacetime as a coverage checklist

Burgess's claim is that four relation types exhaust the ways one thing can relate to
another: **NEAR** (similarity), **LEADS_TO** (causality), **CONTAINS** (composition),
**EXPRESSES** (attribution). Three spatial, one temporal.

For a modeller that is a checklist. Draw the schema, then ask which of the four you
have not expressed:

| Relation | In the memory schema above |
| --- | --- |
| EXPRESSES | `MemoryEntity has Label`, `Support carries Confidence` |
| CONTAINS | `Schema declares Slot`, `Episode involves MemoryEntity` |
| LEADS_TO | `Episode leads to Episode` |
| NEAR | **missing** |

The audit immediately finds the gap: no similarity relation. In most agent memories
similarity is present but implicit, living in a vector index nothing in the schema
mentions. If you add it, model it as a symmetric ring with a weight — and objectify it
if the weight is context-dependent, because *near in what context* is a fact about the
nearness.

## Where the three Part V schemas meet

Memory, promises and audit share `Agent`, `Promise` and `Episode`. The facts that cross
them are ordinary fact types:

```text
Each Promise is made by exactly one Agent.
In each population of "Belief justifies Promise",
  each Belief, Promise combination occurs at most once.
Each Episode records the making of at most one Promise.
In each population of "AuditEvent discharges Promise",
  each AuditEvent, Promise combination occurs at most once.
In each population of "AuditEvent updates Belief",
  each AuditEvent, Belief combination occurs at most once.
```

That is the loop closing: a belief justifies a promise, making the promise is an
episode, an event discharges it, the event updates the belief. **None of those five
fact types can exist if the three schemas were designed separately**, because there
would be no shared identity to join on. Designing them as one conceptual model costs
nothing, because a conceptual model does not commit to a store.
