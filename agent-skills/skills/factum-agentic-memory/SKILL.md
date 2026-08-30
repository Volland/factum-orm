---
name: factum-agentic-memory
description: Design an agent's memory, coordination and audit substrate as ORM 2 conceptual schemas before choosing a store — the six memory layers (entity, semantic, episodic, temporal-causal, epistemic, meta-cognitive), a Promise Theory promise graph for multi-agent coordination, and a tamper-evident audit log. Use when the user is building agent memory, a knowledge graph for an agent, a belief/provenance/confidence layer, multi-agent coordination or delegation, an agent audit trail, or asks how to model episodes, claims, promises, assessments or causality.
---

# Modelling the agent

Agent memory usually gets built the way agent memory gets built: a vector store, a few
tables, a graph schema sketched on a whiteboard, and a growing set of conventions that
live in the retrieval code. It works, then it stops working, and the reason it stopped
is not written down anywhere.

This skill carries three finished conceptual schemas from *Fact-Based Agents* (Part V)
— memory, promises, audit — and the reasoning behind each decision in them. They are
not three databases: they share `Agent`, `Promise` and `Episode`, and they were designed
as one conceptual model precisely so they could be joined later.

**Requires the `factum-orm` skill for notation, the file format and the validator
codes.** This skill is the domain layer on top of it.

## How to use it

1. Ask what the agent actually has to *do*, and get real examples of the memories,
   messages or events it handles. A layer with no example is a layer you do not need
   yet.
2. Start from the reference schema closest to the need — do not rebuild it from
   scratch. `assets/examples/` holds all twelve models from Part V; they validate clean.
3. Adapt, then defend each change as a sentence. Every constraint in these models was
   put there to remove a class of unrepresentable situation; before deleting one, say
   what situation you are giving up.
4. Validate against a real population before believing any of it.

## References

| File | Covers |
| --- | --- |
| `references/memory-layers.md` | L0–L5: entity, semantic, episodic, temporal-causal, epistemic, meta-cognitive; the Map and the Mirror; the Semantic Spacetime coverage checklist |
| `references/promise-graph.md` | Promise Theory as a schema: the five principles, lifecycle, exchange, status-as-history, assessment |
| `references/audit-log.md` | The quaternary that had to become four binaries; the hash chain as a derivation rule; why an audit log must be deontic |

## The five decisions these schemas exist to make

**Enumerate every kind.** A free-text `type` field is the single most common defect in
hand-built memory systems: it produces `agent`, `Agent`, `AGENT` and `ai_agent` within
a month and nothing notices.

**Objectify what carries a property.** A salience on a participation, a confidence on a
support, a verdict on an assessment — these are facts *about* a fact, and there is
nowhere else to put them. The graph mapping then produces the Levi form automatically,
which is the encoding you would have reached by hand three refactors later.

**Ring-constrain every self-relation.** `Episode leads to Episode`, `Promise depends on
Promise`, `Claim contradicts Claim`, `AuditEvent immediately follows AuditEvent`.
Without `irreflexive` + `acyclic`, a causal traversal does not terminate and *what
caused this* has no well-defined answer. A property graph will not stop you writing a
cycle.

**Keep history, do not overwrite state.** A status is a sequence of events with the
current value derived; an assessment supersedes rather than replaces. A changed mind is
evidence.

**Make the rules agents can break deontic.** An audit log built on alethic constraints
cannot audit the violations it exists to catch. That is the single most portable idea
in Part V.
