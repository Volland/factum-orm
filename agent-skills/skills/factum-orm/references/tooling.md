# Factum tooling: CLI, MCP, editor, CI

## factum

```text
factum validate  <model.orm.json> [--strict] [--format text|json|github]
factum verbalize <model.orm.json> [--mode forml|plain] [--population]
factum ddl       <model.orm.json> [--dialect postgres|sqlserver|mysql|sqlite|ansi] [-o file]
factum graph     <model.orm.json> [--subtypes nodeTable|absorb] [-o file]
factum diff      <before.orm.json> <after.orm.json> [--format text|markdown] [--exit-code]
factum drift     <model.orm.json> <schema.sql> [--dialect …] [--ignore-extra] [--exit-code]
factum convert   <input> [-o output] [--to norma|fbm|ossie|ums]
factum derive    <table.csv> [--name Employee] [--delimiter ,] [-o model.orm.json]

  --exit-code   exit 1 when there is something to report, for CI
  --strict      treat warnings as errors
  -o, --output  write to a file instead of standard output
```

Exit codes: `0` success · `1` blocking errors, or something to report with
`--exit-code` · `2` the input could not be read or parsed.

`factum diff` reports what changed **as sentences**, not as a JSON diff — which is what
makes a model change reviewable by someone who does not read JSON.

### Recipes

```bash
# Put the domain in front of an agent that does not speak MCP
factum verbalize model/domain.orm.json > .agent/domain.md

# How big is the domain, really
factum verbalize model/domain.orm.json | wc -w

# Fail CI when the model is broken, warnings included
factum validate model/domain.orm.json --strict

# Annotate a GitHub Actions run
factum validate model/domain.orm.json --format github

# Show a reviewer what the model now says
factum diff origin-main.orm.json model/domain.orm.json --format markdown

# Fail CI when production has moved on without the model
factum drift model/domain.orm.json db/schema.sql --exit-code

# Both mappings, as a consistency check on the conceptual model
factum ddl   model/domain.orm.json --dialect postgres -o build/schema.sql
factum graph model/domain.orm.json -o build/schema.cypher

# A first draft from a real export
factum derive export.csv --name Customer -o draft.orm.json

# Archive in the exchange format
factum convert model/domain.orm.json --to fbm -o archive/domain.fbm
```

### GitHub Actions

```yaml
name: model
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: git show origin/${{ github.base_ref }}:model/domain.orm.json > /tmp/base.orm.json
      - uses: Volland/factum-orm@v0
        with:
          model: model/domain.orm.json
          base: /tmp/base.orm.json
          strict: 'true'
```

## factum-mcp

```jsonc
{ "mcpServers": { "factum": { "command": "factum-mcp" } } }
```

Speaks stdio. Runs locally. Makes no network calls.

| Tool | Inputs | Returns |
| --- | --- | --- |
| `read_model` | `path`, `full?` | Outline of object types, fact types, readings, subtypes — or the whole document |
| `verbalize_model` | `path`, `mode?`, `population?` | FORML sentences, optionally with sample facts |
| `validate_model` | `path` | Problems, with severity and code |
| `generate_schema` | `path`, `target`, `dialect?` | SQL DDL or Cypher DDL, plus mapping notes |
| `diff_models` | `before`, `after` | What changed, as sentences |
| `detect_drift` | `path`, `sqlPath`, `ignoreExtraTables?` | Differences and reconciling statements |
| `read_population` | `path` | Sample facts, read back through the readings |
| `apply_model` | `path`, `model`, `allowErrors?` | A validated write; refused when the model has blocking errors |

### The guarded write

`apply_model` validates before it writes and refuses a model with blocking errors. This
is the load-bearing part of the design. An agent can be wrong — no amount of prompting
changes that. What matters is that **it cannot quietly commit an incoherent schema.**
The failure mode being guarded is not "the agent proposes something bad"; it is "the
agent proposes something bad and nothing notices until it is a migration".

```text
Refused: the model has 2 blocking error(s).
error: [uniqueness-too-narrow] An internal uniqueness constraint on
"AuditEvent records that Actor performed Action on Resource" spans 1 of 4 roles.
```

The agent gets that back and fixes it, because the message says exactly what is wrong
and the fix is mechanical.

### The loop that works

1. `verbalize_model` — the agent reads what the domain says. Not the tables, not the
   code. The rules.
2. `read_population` — real examples, so the proposal is grounded in values rather than
   type names.
3. Propose the change.
4. `validate_model` — the agent checks its own work, including against the population.
5. `apply_model` — the guarded write.
6. `diff_models` — render the change as sentences for human review.

Steps 1, 2, 4 and 6 are free and deterministic. Step 3 is where the model earns its
keep. Step 5 is the only one that can do damage, and it is the one with a gate on it.

### Project instructions worth adding

```text
The conceptual schema in model/domain.orm.json is authoritative for domain
rules. Read it with verbalize_model before answering questions about what the
system means, and read_population before proposing a constraint.

Where the code disagrees with the model, the code is a bug or the model is
stale — say which you think it is, do not average them.

Run validate_model before claiming a model change is complete. Quote the FORML
sentence that supports any claim about a rule.
```

## Editor commands

| Command | Description |
| --- | --- |
| `ORM: New ORM Model` | Create a starter `.orm.json` and open the diagram |
| `ORM: Import NORMA (.orm) File` | Convert a NORMA ORM 2 XML file |
| `ORM: Import Model (NORMA, FBM, Ossie, UMS)` | Convert any supported interchange document |
| `ORM: Export Model As (NORMA, FBM, Ossie, UMS)` | Write the model out in an interchange format |
| `ORM: Derive Model from Example Data (CSV)` | Propose a first-draft model from a table |
| `ORM: Verbalize Model` | Full FORML verbalization as Markdown |
| `ORM: Show Relational Mapping` | Mapped tables as a Markdown table |
| `ORM: Generate Relational Schema (SQL DDL)` | SQL DDL in a new editor |
| `ORM: Generate Property Graph Schema (LadybugDB)` | Cypher DDL in a new editor |
| `ORM: Export Diagram as SVG` / `as PNG` | Save the diagram as an image |
| `ORM: Auto-Layout Diagram` | Re-arrange the diagram |
| `ORM: Open Model Source (JSON)` | Open the model as text |

### Settings

`orm.ddl.dialect` (`postgres`) · `orm.ddl.quoteIdentifiers` (`false`) ·
`orm.graph.subtypeStrategy` (`nodeTable`) · `orm.graph.ifNotExists` (`false`) ·
`orm.validation.enabled` (`true`) · `orm.verbalization.mode` (`forml`) ·
`orm.diagram.snapToGrid` (`true`) · `orm.diagram.gridSize` (`10`) ·
`orm.diagram.showGrid` (`true`)

### Keyboard

`V`/`E`/`T` select / entity type / value type · `1`/`2`/`3` unary / binary / ternary ·
`S` subtype link · `C` connect role · `F` zoom to fit · `Ctrl/Cmd+Alt+L` auto-layout ·
`Delete` · `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` · middle-drag or drag empty canvas to pan,
wheel to zoom · double-click a shape to rename in place · `Shift`-click to add to
selection.

## Interchange formats

| Format | Kind | Round trip |
| --- | --- | --- |
| NORMA `.orm` | ORM 2 XML, the community's de-facto archive | Good; keys on GUIDs |
| FBM Exchange MetaModel | XML, FactEngine community | Closest to lossless |
| Apache Ossie | Semantic metadata, ASF incubating | Conceptually closest of any format |
| UMS | YAML, **logical** not conceptual | Good target, lossy source |

`factum convert <input> --to norma|fbm|ossie|ums`. Preserve `meta.guid` — NORMA, Boston
and FBM key on GUIDs rather than on readable ids, and that is what survives a round
trip.
