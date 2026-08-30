---
description: Design an agent's memory, promise graph or audit log as an ORM 2 conceptual schema
argument-hint: [memory | promises | audit | join] [what the agent has to do]
---

Design the agent substrate for: **$ARGUMENTS**

Use the `factum-agentic-memory` skill, and `factum-orm` for the notation and the
checker.

Start by asking what the agent actually has to **do**, and get real examples of the
memories, messages or events it handles. A layer with no example is a layer you do not
need yet. Then start from the closest reference schema in `assets/examples/` rather
than from a blank file.

**memory** — the six layers. L0/L1 entity and semantic, L2/L3 episodic and causal,
L4 epistemic, L5 meta-cognitive. Ask which layers this agent needs; most need three,
not six. Run the Semantic Spacetime coverage checklist (NEAR, LEADS_TO, CONTAINS,
EXPRESSES) at the end and name the gap.

**promises** — multi-agent coordination. Check that the schema keeps: a mandatory
promiser, `rejected` as a first-class status, `+` and `-` promise kinds, a dependency
ring, status as a history rather than a field, and one assessment per assessor per
promise with `self` and `witness` stances.

**audit** — the event log. Start from four binaries, not one quaternary. Then the
chain: a derivation rule that names what is hashed and what it is chained to, two
uniqueness bars rather than one, an acyclic ring, and the disjunctive-mandatory plus
exclusion that makes the chain connected. Then check the modality: an audit log built
on alethic constraints cannot audit the violations it exists to catch.

**join** — if the agent needs more than one of these, model them as **one** conceptual
schema sharing `Agent`, `Promise` and `Episode`. The cross-schema fact types cannot
exist if the three are designed separately, and a conceptual model does not commit to
a store, so joining them costs nothing now and is impossible later.

For every constraint you carry over from a reference schema, be able to say what class
of unrepresentable situation it removes. For every one you drop, say what I am giving
up. Validate against a real population before believing any of it.
