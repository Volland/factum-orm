# Heuristics, anti-patterns and the review checklist

The procedure tells you the order. This tells you what to do inside each step.

## Ten heuristics that hold up

1. **Name fact types with verbs, object types with nouns.** `Person works for
   Company`, not `Person Company Employment`. If the reading has no verb, the fact type
   is an attribute in disguise. This matters more for agent-facing models: `Agent
   Promise Assessment` could mean four things; `Assessment assesses Promise` means one.
2. **Add the inverse reading whenever a human would say it.** One line of JSON, double
   the chance a domain expert spots an error — they read the fact from the end they
   think about it from.
3. **Prefer more, smaller fact types.** The cost of an unnecessary split is one extra
   fact type. The cost of an unnecessary join is a constraint you cannot state, and you
   will not notice until the rule matters.
4. **Make the reference mode a real one.** `Person(.id)` over a surrogate is a smell:
   the domain has no natural identifier and nobody asked why. Sometimes there genuinely
   isn't one. Often there is and nobody wrote it down. An entity type with no reference
   scheme gets a generated key plus a mapping note — treat that note as a to-do.
5. **Enumerate every code.** Any value type with a fixed real range gets a value
   constraint. Always. Cheapest constraint, highest payback in agent-facing work.
6. **Decide the modality explicitly for every rule.** *If this is violated, should the
   write fail, or should there be a record of the violation?* Defaulting produces
   systems that cannot audit themselves.
7. **Use a ring constraint on every self-relation.** Otherwise you have asserted that
   self-reference and cycles are legal.
8. **Objectify only when the fact needs a property.** The test: *do I need to say
   something about this fact?* If not, leave it a fact type. Unnecessary reification
   makes every query one hop longer for no gain.
9. **Keep hints out of the conceptual model.** Strip every `meta` and `hints` and the
   model must still say the same thing. Wanting a hint to express a rule means the rule
   belongs in a constraint.
10. **Populate everything.** A fact type with no sample facts is a hypothesis.

## Six anti-patterns

The first three a validator catches. The last three only a reader does.

### The attribute in disguise
A value type playing a role that should belong to an entity type — because the source
system had a column and the column had a string in it. **Find it** by asking whether
the value needs facts of its own: a category, a timestamp, a relationship. The stronger
form: *can the attribute have an attribute?* **Fix:** promote it, give it a reference
mode, move the label into its own fact type.

### The unconstrained fact type
`missing-uniqueness`. The fact type asserts only that the fact is possible — nothing
about how many times, so the mappers have nothing to work from. **Fix:** decide. If the
answer really is "any number of times", draw the spanning bar. That is a statement, and
it differs from silence.

### The compound n-ary
`uniqueness-too-narrow`. A row in a source table became a fact type; rows bundle
independent facts, fact types must not. **Fix:** split.

### The optional-by-accident role
A role with no mandatory dot that nobody ever discussed. An undiscussed optional role
is no better than a nullable column — it is the exact defect ORM was supposed to fix,
reproduced inside the model. **Fix:** during step 5, say *"not every X does this"* out
loud for every role.

### The alethic overreach
A rule modelled as necessary that is really obligatory. The system becomes unable to
record a legitimate exception; six months later someone adds a nullable
`override_reason` and a code path that skips validation, and the rule exists in two
places and agrees with itself by luck. **Fix:** deontic modality.

### The unpopulated fact type
Nobody can give you one real example. In fact-based modelling that is close to proof
the fact type does not exist — fact types come *from* examples, so one with no example
came from somewhere else, usually a requirements document written by someone describing
a system rather than a domain. **Fix:** ask for an example. If none arrives, delete it.
You can add it back when the example does.

## Modelling for agents specifically

Everything above is ordinary ORM practice. Five things change when the primary reader
is a language model.

- **Write `meta.description` on things whose names are ambiguous.** It becomes a comment
  on the generated table and node table, and it is the one place prose is genuinely
  useful — for the *why*, never the *what*. The what is already stated as constraints.
- **Use `meta.synonyms` for the words your users actually say.** When the domain says
  "booking", the database says `reservation` and the ticketing system says "hold", an
  agent reading only the model cannot connect a question to the fact type.
- **Use `meta.aiContext` for guidance, not rules.** A rule that lives only there does
  not verbalize, does not validate and does not map.
- **Keep the model small enough to read whole.** If the verbalization no longer fits a
  prompt, split the model by subdomain before reaching for retrieval. Several small
  models an agent loads entirely beats one large model it has to search.
- **Make the deontic constraints deontic.** Agents violate obligations; that is what
  obligations are for.

## The review checklist

Before committing a model:

- [ ] The model validates clean, or every remaining warning is understood.
- [ ] Every fact type has a uniqueness constraint.
- [ ] Every role's mandatory status was decided, not defaulted.
- [ ] Every self-relation has a ring constraint.
- [ ] Every enumerated value type has a value constraint.
- [ ] Every rule agents can legitimately break is deontic.
- [ ] Every fact type has at least one sample fact.
- [ ] The verbalization reads as sentences a domain expert would say.
- [ ] Both mappings — relational and graph — produce something you would ship.
- [ ] The mapping notes contain no surprises.

The last two matter more than they look. Generating both mappings is a cheap
consistency check on the conceptual model: a schema that produces an ugly graph *and*
an ugly set of tables usually has a modelling problem, not two mapping problems.
