# The book behind this skill

*Fact-Based Agents — ORM 2, FORML and Factum for Agentic Memory*, Volodymyr Pavlyshyn.
Six parts, 23 chapters, 8 appendices, 73 figures, 63 exercises.

- The book: <https://leanpub.com/fact-basedagents>
- The models, openable in Factum: <https://github.com/Volland/factum-book-models>
- Factum — editor, CLI, MCP server: <https://www.factum-orm.com/>

Every ORM diagram in the book is rendered from a model file that ships with it, and
every FORML sentence and tool output quoted is real output, not a paraphrase. Use this
map when the user asks *where is this covered* or wants more depth than a reference
file gives.

## Part I — Why a fact layer

| Ch | Title | What it settles |
| --- | --- | --- |
| 1 | The Fact Layer Your Agent Is Missing | Why a nullable column is an undiscussed rule, and what an agent does with one |
| 2 | The Elementary Fact | No attributes; the arity check; roles, readings, entity vs value types |
| 3 | FORML, and the End of the Context Wall | Why sentences beat schemas as agent context; alethic vs deontic |
| 4 | What Else Could Hold This | OWL, SHACL, ER, UML, JSON Schema — what each can and cannot say |

## Part II — The visual formalism

| Ch | Title | What it settles |
| --- | --- | --- |
| 5 | Reading the Diagram | The three shapes, the marks, the uniqueness-bar misreading |
| 6 | The Constraint Family | All eight kinds, with what each maps to |
| 7 | Subtyping and Objectification | When to reify, what it costs, what it maps to |
| 8 | Exercises: Reading the Notation | With model files, most invalid on purpose |

## Part III — Building models that hold up

| Ch | Title | What it settles |
| --- | --- | --- |
| 9 | The Design Procedure, Worked | CSDP end to end on a staffing domain |
| 10 | Strategies, Heuristics and Anti-patterns | Ten heuristics, six anti-patterns, the review checklist |
| 11 | Populations | The three jobs a sample population does, and how many rows |
| 12 | Exercises: Method, Populations and Design | |

## Part IV — Factum

| Ch | Title | What it settles |
| --- | --- | --- |
| 13 | The Editor | Drawing, the properties panel, live verbalization |
| 14 | The Command Line, in Depth | Every subcommand, the Rmap rules, CI |
| 15 | Giving an Agent the Fact Layer | The eight MCP tools, the guarded write, the loop |
| 16 | Export to LadybugDB and Graph-Powered Memory | The graph mapping rules, reification, the honest limits |
| 17 | Schema Evolution and Migration | Diff, drift, expand-and-contract, two worked migrations |

## Part V — Modelling the agent

| Ch | Title | What it settles |
| --- | --- | --- |
| 18 | Agentic Memory as a Conceptual Schema | The six layers L0–L5; Semantic Spacetime as a coverage checklist |
| 19 | A Promise Graph for Multi-Agent Interaction | Promise Theory as a schema; status as history; assessments |
| 20 | The Audit Log as an ORM 2 Model | A quaternary that had to become four binaries; the hash chain |
| 21 | Exercises: Modelling the Agent | |

## Part VI — Interoperability

| Ch | Title | What it settles |
| --- | --- | --- |
| 22 | Interoperability | NORMA, FBM, UMS, Ossie: what each carries, what each loses |
| 23 | Metadata, Hints and Extension Points | `meta`, `hints`, `x-`, the `aiContext` trap |

## Appendices

| | Title |
| --- | --- |
| A | FORML Quick Reference — every sentence form the verbalizer emits |
| B | CLI and MCP Reference |
| C | Validation Codes |
| D | Glossary |
| E | Answers — 63 worked exercise answers, each a model you can diff against |
| F | Sources and Further Reading |
| G | Porting the Graph Mapping — Neo4j, Memgraph and others |
| H | The Fact-Layer Benchmark — what it measures and what it does not |

## Vocabulary worth using precisely

**Alethic** — *it cannot be otherwise*; enforced by the generated schema.
**Deontic** — *it should not be otherwise, but the system must be able to record the
violation*; deliberately not enforced.
**Arity** — the number of roles in a fact type.
**Arity check** — a uniqueness constraint spanning fewer than n−1 roles means the fact
type is splittable.
**Elementary fact** — the smallest statement that says something about the world and
cannot be split without losing information.
**Entity type** — identified by something else, via a reference scheme; solid outline.
**Value type** — lexical, identifies itself; dashed outline.
**Reference mode** — the abbreviated identification scheme in parentheses: `Person(.nr)`.
**Reading** — a sentence template with `{0}`, `{1}` placeholders over a role order.
**Internal / external uniqueness** — within one fact type / spanning several.
**Frequency** vs **cardinality** — how many times an instance plays a role / how many
instances exist.
**Objectification** (reification, nesting) — turning a fact type into an object type so
it can play roles.
**Exclusive / exhaustive / partition** — of a subtype set: no instance in more than one
/ every instance in at least one / both.
**Population** — sample tuples stored against a fact type; grounds the verbalization and
falsifies constraints.
**Rmap** — the algorithm mapping an ORM schema to a relational one.
**Bipartite (Levi) form** — a hyperedge encoded as a node linked to each participant;
what objectification maps to in a graph.
**Semantic Spacetime** — Burgess's four-relation grammar: NEAR, LEADS_TO, CONTAINS,
EXPRESSES. Useful as a coverage checklist.
