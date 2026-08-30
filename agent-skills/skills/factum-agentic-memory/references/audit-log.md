# The audit log as an ORM 2 model

Models: `assets/examples/fig-audit-core.orm.json` (the naive version, invalid on
purpose), `fig-audit-split.orm.json`, `fig-audit-chain.orm.json`,
`fig-audit-full.orm.json`.

## Attempt one, and why the validator refuses it

The obvious model matches the log line: an audit event records that some actor performed
some action on some resource.

```text
error   uniqueness-too-narrow   An internal uniqueness constraint on
"AuditEvent records that Actor performed Action on Resource" spans 1 of 4 roles.
It must span at least 3; otherwise the fact type is not elementary and should
be split.
```

The uniqueness constraint spans one role of four, which says an event determines its
actor, its action *and* its resource. Since the actor does not constrain the action, and
the action does not constrain the resource, **the quaternary is three independent facts
wearing one coat.**

Not pedantry — the consequences are concrete:

- You cannot make the resource optional without also making the actor optional. Some
  events (a scheduled sweep) genuinely have no resource.
- You cannot state that an actor acts on behalf of a principal, because `Actor` only
  exists inside this fact type.
- You cannot add a field to the action without touching the shape of the event.

Every one of those is a schema change you will want within a year, and in the wide-table
design every one is a nullable column added to a table with a billion rows.

## Attempt two: elementary

```text
Each AuditEvent was performed by exactly one Actor.
Each AuditEvent performed exactly one Action.
Each AuditEvent acted on at most one Resource.
Each AuditEvent occurred at exactly one Instant.
```

Four facts, each functional, three mandatory. **`acted on Resource` is deliberately
optional**, and the sample population makes the decision legible: `run.start` and
`run.end` act on no resource, and they are in the rows. In the quaternary they were
unrepresentable. Had you drawn the dot, the verbalization would read *exactly one
Resource*, the population would have had to invent a resource for a session boundary,
and the log would quietly be lying about what happened.

## The chain

Tamper-evidence and order are not properties you assert. They follow from stating four
things the code usually keeps to itself.

### The digest is derived, and the rule says from what

```text
AuditEvent is sealed by Digest is derived and stored. Derivation rule:
AuditEvent is sealed by Digest where Digest is the AuditEvent's
DigestAlgorithm applied to its CanonicalForm concatenated with the Digest of
the AuditEvent it immediately follows, or with the empty string where the
AuditEvent opens its Run.
```

A digest that is merely *stored* proves nothing. Tamper-evidence comes from the digest
being a function of the event's content **and** of its predecessor's digest, so changing
any event invalidates every digest after it.

The rule forces two object types the naive version omits. **`CanonicalForm`** is the
exact byte sequence hashed — *hash the event* is not a specification, and two
implementations that serialise a timestamp differently produce different digests for the
same event. **`DigestAlgorithm`** carries the algorithm *and its version*:

```text
It is necessary that the possible values of DigestAlgorithm are
  {'sha-256/v1', 'blake3/v1'}.
```

Without that, a log spanning an algorithm migration is unverifiable, and every audit log
that lives long enough spans one.

### Order is two uniqueness bars, not one

```text
Each AuditEvent immediately follows at most one AuditEvent.
Each AuditEvent is related to at most one AuditEvent in
  "AuditEvent immediately follows AuditEvent".
```

Each event follows at most one predecessor *and* is followed by at most one successor:
a linked list, stated conceptually. A spanning bar would say many-to-many, which is a
DAG, which is not a chain. That distinction is what makes the generated relationship
`ONE_ONE` rather than `MANY_MANY` — the difference between a chain the database enforces
and a chain the application hopes for.

### The ring is irreflexive and acyclic

An event cannot follow itself and the chain cannot loop. Without it a "chain" can be a
ring and every ordering query runs forever.

### Connectivity is a disjunctive mandatory plus an exclusion

Two bars and an acyclic ring permit something that looks like a chain and is not:
several disconnected fragments, each internally well-ordered, with no way to tell that a
span of events was excised wholesale.

```text
Each Run is opened by exactly one AuditEvent.
It is necessary that each AuditEvent participates in at least one of:
  Run is opened by AuditEvent or AuditEvent immediately follows AuditEvent.
It is necessary that no AuditEvent both some Run is opened by some AuditEvent
  and some AuditEvent immediately follows some AuditEvent.
```

Every event either opens its run or follows exactly one other event, never both; a run
has exactly one head. Together with the two bars and the acyclic ring that is a single
connected chain per run — and deleting a span now leaves a detectable hole, because the
event after it follows an event that is not there.

### What the notation cannot say, said out loud

That an event's predecessor belongs to the *same* run is a join constraint: it follows a
path from event to predecessor to run, and ORM's set-comparison constraints compare role
sequences position by position rather than traversing joins. Record it on the fact type
as a `meta.description` and enforce it in the writer. **Know which of your rules live in
the model and which live in a comment beside it.**

### One claim to retire

`is sealed by Digest` being 1:1 does *not* establish collision resistance — that is a
property of the hash function, and no schema can assert it. What the 1:1 constraint says
is narrower and still worth having: **in any legal population, no two events share a
digest.** A duplicate digest is then a validation failure rather than a subtle security
incident nobody notices.

## What it maps to

```cypher
CREATE NODE TABLE AuditEvent(
    id INT64 PRIMARY KEY,
    instant TIMESTAMP,      // mandatory
    eventOutcome STRING,    // mandatory; values {'allowed', 'denied', 'failed'}
    digest STRING           // mandatory
);

CREATE REL TABLE WAS_PERFORMED_BY(FROM AuditEvent TO Actor, MANY_ONE);
CREATE REL TABLE PERFORMED(FROM AuditEvent TO Action, MANY_ONE);
CREATE REL TABLE ACTED_ON(FROM AuditEvent TO Resource, MANY_ONE);
CREATE REL TABLE BELONGS_TO(FROM AuditEvent TO Run, MANY_ONE);
CREATE REL TABLE IMMEDIATELY_FOLLOWS(FROM AuditEvent TO AuditEvent, ONE_ONE);
CREATE REL TABLE DISCHARGES(FROM AuditEvent TO Promise, MANY_MANY);
CREATE REL TABLE ACTS_ON_BEHALF_OF(FROM Actor TO Principal, MANY_ONE);
```

## Why an audit log must be deontic

Suppose the rule is *an agent must not act on a resource outside its assigned scope.*

Model it alethic and the write fails, so the out-of-scope action leaves no trace — the
log records exactly nothing about the event you most wanted to know about. Model it
deontic and the event is recorded, flagged and queryable:

```text
It is obligatory that if some AuditEvent acted on some Resource
then some Resource is in scope for some Run.
```

**An audit log built on alethic constraints cannot audit the violations it exists to
catch.** That is the single idea from Part V most worth carrying into a design review.
