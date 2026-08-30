# The Factum Skill Set

*An ORM 2 modelling copilot for Claude Code, distilled from
[Fact-Based Agents](https://leanpub.com/fact-basedagents).*

Ten commands and two skills that help you build a conceptual schema that says exactly
what your domain says — draw the diagram, constrain it, read it back as sentences a
domain expert can confirm or reject, and map it to tables or a graph when you are
ready.

|  |  |
| --- | --- |
| The book | <https://leanpub.com/fact-basedagents> |
| Factum — editor, CLI, MCP server | <https://www.factum-orm.com/> |
| The models, openable in Factum | <https://github.com/Volland/factum-book-models> |

---

## Why this exists

Object-Role Modeling has **no attributes**. A domain is a set of *elementary facts* —
`Person works for Company` — and every rule is an explicit constraint on a role. Two
things follow, and they are the reason this skill set is worth installing:

- **Nothing is silently defaulted.** A nullable column is an undiscussed rule. An
  optional role in ORM is a *positive claim* that instances without that fact are
  legal — and the model says so out loud, in a sentence, every time you read it.
- **The model reads back as English.** Which means a domain expert can reject it in
  five seconds, and a language model can be handed the rules instead of the storage
  layout.

The hard part is not the notation. The hard part is the discipline: starting from real
examples, constraining in the right order, and never asserting a rule nobody confirmed.
That discipline is what these commands automate.

---

## Install

**As a Claude Code plugin** — commands become `/factum:orm-model`, and both skills load
automatically when a task mentions ORM, FORML or agent memory:

```bash
# from a marketplace that carries it
/plugin install factum

# or point Claude Code at this directory directly
```

**Or copy the pieces by hand** — commands become `/orm-model`:

```bash
cp -r factum-skills/skills/*   ~/.claude/skills/
cp -r factum-skills/commands/* ~/.claude/commands/
```

Use `.claude/skills` and `.claude/commands` inside a project instead of `~/.claude` to
scope it to one repository.

**Optional but recommended.** The [Factum extension](https://www.factum-orm.com/) gives
you the `factum` CLI, the `factum-mcp` server and the diagram editor. Every command
works without it — the skill ships its own offline checker — but with it installed the
commands quote real tool output instead of reasoning about what the output would be.

```jsonc
// with the MCP server, an agent gets eight tools and a guarded write
{ "mcpServers": { "factum": { "command": "factum-mcp" } } }
```

---

## The commands

Ten commands, in the order you would actually use them.

### Starting a model

#### `/orm-model` — build a model from real examples

Runs Halpin's seven-step Conceptual Schema Design Procedure as a conversation, stopping
at each step for a yes or no.

```
/orm-model our on-call rotation
/orm-model data/shifts.csv
```

**Why it is useful.** The order of the seven steps is load-bearing, and almost every
bad ORM model comes from constraining before all the fact types are on the page. This
command will not let you skip ahead, will not add a constraint you have not confirmed,
and will ask for three real rows before it names a single object type. It also proposes
every constraint as **the sentence it produces**, which is the form people can actually
reject.

#### `/orm-derive` — draft a model from what you already have

```
/orm-derive exports/customers.csv
/orm-derive db/schema.sql
/orm-derive src/models/booking.ts
```

**Why it is useful.** Getting from a CSV to one binary fact type per column is
mechanical, and the tool does it. The command then does the part no derivation can do:
tells you which columns are really about something else, which fact types are more than
one thought, and — the valuable one — turns **every nullable column into a question for
you.** That list is usually the first time anyone has written down what those columns
were supposed to mean.

### Checking and repairing

#### `/orm-review` — a four-pass review

```
/orm-review model/domain.orm.json
```

Runs four separate passes and reports them separately: the **validator** (with the
mechanical fix for each code), the **six anti-patterns** by name, the **ten-item
pre-commit checklist**, and — the pass the other three cannot replace — **reading the
verbalization aloud** and flagging every sentence a domain expert would find odd.

**Why it is useful.** A model can validate clean and still be wrong. Passes 1 to 3
catch ill-formed; pass 4 catches wrong. Findings come back ranked: blocking, worth
fixing, worth a conversation. Nothing is changed unless you ask.

#### `/orm-fix` — repair the errors, one code at a time

```
/orm-fix model/domain.orm.json
```

**Why it is useful.** Every validation code maps to a mechanical fix, so most of this
is safe to automate — but two categories are not, and the command knows the difference.
`missing-uniqueness` is a question, not a defect. A population violation means either
the constraint is too strong or the data is bad, and **which one is a domain question**
that gets put back to you rather than guessed. It finishes by showing you the
verbalization diff: what the model said before, and what it says now.

### Reading and drawing

#### `/orm-verbalize` — sentences, shaped for their audience

```
/orm-verbalize model/domain.orm.json for-expert
/orm-verbalize model/domain.orm.json for-agent
```

**Why it is useful.** The same model wants three different presentations. **For an
expert**, the sentences most likely to be *wrong* go first — the optional roles, the
enumerated sets, the exclusions — and it ends with direct questions, because a rule
stated badly gets corrected faster than a rule requested politely. **For an agent**, it
keeps the necessity prefixes and the population, writes the file, and tells you where to
point at it — and if the verbalization no longer fits a prompt, it proposes splitting
the model by subdomain rather than reaching for retrieval.

#### `/orm-diagram` — lay it out, render it, or read it back

```
/orm-diagram model/domain.orm.json layout
/orm-diagram model/domain.orm.json explain
```

**Why it is useful.** The diagram *is* the model — there is no separate drawing to keep
in sync — so "drawing an ORM diagram" really means writing sensible coordinates. This
command knows the layout rules that produce a legible figure (hub and spoke, 70 units
between rows, subtypes directly below their supertype, constraint glyphs between the
roles they span) and warns you when a reading is long enough to overflow the page. In
`explain` mode it walks a diagram mark by mark and calls out the uniqueness patterns
explicitly — one bar, two bars, one spanning bar — because **that is the mark almost
everyone misreads**, and two of the three readings are opposites.

### Shipping it

#### `/orm-map` — SQL and Cypher, with the reasoning

```
/orm-map model/domain.orm.json postgres
/orm-map model/domain.orm.json both
```

**Why it is useful.** It generates both targets by default, because doing so is a cheap
consistency check on the conceptual model: a schema that produces an ugly graph *and* an
ugly set of tables usually has a modelling problem, not two mapping problems. Then it
does the part that matters more than the DDL — explains each column and multiplicity
**from the constraint that caused it**, reads the mapping notes out loud (a surrogate key
means an object type has no reference scheme, and that is a to-do), and for every
constraint the target cannot enforce, writes the validation query that would catch a
violation and says where it should run.

#### `/orm-evolve` — plan a schema change

```
/orm-evolve model/domain.orm.json splitting AuditEvent into four binaries
```

**Why it is useful.** It diffs the model **as sentences**, so the change is reviewable
by someone who does not read JSON; measures drift against the real database in both
directions; stages the work as expand-and-contract with each generated statement
assigned to a step; and — the step everyone forgets — **names the constraints the
database will not hold**, so they end up in the writer or a check rather than in
somebody's memory.

### For agent builders

#### `/orm-memory` — memory, promises and audit as conceptual schemas

```
/orm-memory memory   a research agent that has to explain why it believes things
/orm-memory promises  a delegation network across five agents
/orm-memory audit     a tamper-evident trail for tool calls
/orm-memory join      all three
```

**Why it is useful.** It starts from three finished, validated schemas rather than a
blank file, and it can say **what class of unrepresentable situation each constraint
removes** — so when you drop one, you know what you are giving up. It carries the
decisions that are expensive to discover late: separating `Belief` from `Claim` so
disagreement is representable, keeping `rejected` as a first-class promise status
because *the refusal is the evidence*, objectifying `Support` so a confidence can carry
a timestamp, and making an audit log deontic, because **an audit log built on alethic
constraints cannot audit the violations it exists to catch.**

The `join` mode is the one worth knowing about: the three schemas share `Agent`,
`Promise` and `Episode`, and the fact types that cross them **cannot exist if the three
were designed separately.** A conceptual model does not commit to a store, so joining
them costs nothing now and is impossible later.

#### `/orm-explain` — teach me this

```
/orm-explain the difference between frequency and cardinality
/orm-explain uniqueness-too-narrow
/orm-explain why is objectification worth the extra hop
```

**Why it is useful.** Answers in a fixed shape — the idea, a worked example from a real
model file, what it changes in the SQL and the graph, the concrete failure mode when
it is got wrong, and where to read more. For a validator code it leads with the fix and
then explains why the rule exists. For a "why does ORM do it this way" question it
answers honestly, including where the notation has a real limitation.

---

## A first session

```
/orm-derive exports/oncall.csv          # a draft, and a list of questions
/orm-model  the on-call rotation        # the seven steps, properly
/orm-review model/oncall.orm.json       # four passes
/orm-fix    model/oncall.orm.json       # repair what pass 1 found
/orm-verbalize model/oncall.orm.json for-expert    # take it to a human
/orm-map    model/oncall.orm.json both  # only once the sentences are right
```

The order matters more than it looks. Mapping before verbalizing means you find out
about the wrong constraint after the migration.

---

## What is inside

```
factum-skills/
  commands/                     ten slash commands
  skills/
    factum-orm/                 the core modelling copilot
      SKILL.md
      references/
        csdp.md                 the seven steps, worked
        model-format.md         authoring .orm.json by hand
        constraints.md          the eight kinds: JSON, sentence, mapping, when
        notation.md             reading the diagram, and laying one out
        forml.md                every sentence form the verbalizer emits
        validation.md           every code, with its mechanical fix
        practices.md            ten heuristics, six anti-patterns, the checklist
        mapping.md              Rmap and the graph mapping, hints, drift
        tooling.md              CLI, MCP, editor, CI
        book-map.md             where each idea lives in the book
      assets/
        starter.orm.json        a minimal valid model
        examples/               eleven real models from the book
      scripts/
        check-model.mjs         offline validator, no install required
    factum-agentic-memory/      Part V: the agent substrate
      SKILL.md
      references/
        memory-layers.md        L0-L5, the Map and the Mirror, the SST checklist
        promise-graph.md        Promise Theory as a schema
        audit-log.md            four binaries, a hash chain, and why it is deontic
      assets/examples/          twelve models from Part V
  .claude-plugin/plugin.json
```

### The offline checker

`skills/factum-orm/scripts/check-model.mjs` implements the structural, identification,
elementarity, reading, compatibility, subtyping, population and hygiene checks with no
dependencies:

```bash
node check-model.mjs model.orm.json [--strict] [--format text|json]
```

It agrees with `factum validate` on code and severity across all 79 models shipped with
the book, including the ones that are invalid on purpose. Where the CLI is installed,
the CLI is the authority; this is here so the copilot can always check its own work.

```text
error   uniqueness-too-narrow   An internal uniqueness constraint on
"AuditEvent records that Actor performed Action on Resource" spans 1 of 4 roles.
It must span at least 3; otherwise the fact type is not elementary and should
be split.
```

---

## The three rules these commands never break

**Start from real examples.** A fact type with no sample row is a hypothesis. Fact types
come *from* examples; one with no example came from somewhere else, usually a
requirements document written by someone describing a system rather than a domain.

**Propose rules as sentences, and wait.** People who cannot state a rule will correct a
rule stated badly, immediately and precisely. That is the entire reason verbalization
exists, and it is why nothing here proposes a constraint as a diagram change.

**Do not average the model and the code.** Where they disagree, one of them is a bug and
the other is stale. Say which you think it is.

---

## Credits

Distilled from *Fact-Based Agents: ORM 2, FORML and Factum for Agentic Memory* by
Volodymyr Pavlyshyn. The design procedure, the arity check and the constraint family are
Terry Halpin's and are tool-independent; the file format, the validation codes and the
command names are Factum's. Promise Theory and Semantic Spacetime are Mark Burgess's.
