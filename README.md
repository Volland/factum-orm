# Factum — Object-Role Modeling (ORM 2)

*factum* — a thing done; a fact.

Draw a conceptual schema in ORM 2 notation, read it back as English sentences, check it for errors,
and map it to a relational **or** property graph schema — without leaving the editor.

In the spirit of [NORMA](https://www.ormfoundation.org/), but native to VS Code and storing models as
plain JSON, so they diff and merge like the rest of your source.

**[Documentation and guide →](https://volland.github.io/factum-orm/)**

![The ORM diagram editor with live FORML verbalization](media/screenshot-diagram.png)

## Why Object-Role Modeling

ORM describes a domain as **elementary facts** — *Person works for Company* — instead of tables or
classes. Because those facts are attribute-free, every constraint is explicit and every model can be
read back as plain sentences a domain expert can confirm or reject. You decide how it becomes tables
or nodes afterwards, and the same model can become both.

## Features

### Draw the conceptual schema

Entity types and value types with reference modes (`Person(.nr)`), unary through n-ary fact types with
multiple readings, subtyping, objectification (nesting) and derived fact types. Drag to move, marquee
to multi-select, drag a role onto an object type to connect it, double-click to rename in place —
typing `Person(.nr)` sets the name and reference mode at once.

Constraints are drawn in standard ORM 2 notation: internal and external uniqueness, preferred
identifiers, simple and disjunctive mandatory, frequency, all ten ring types, subset, exclusion,
equality, value and cardinality — each editable in the properties panel and each carrying an
alethic/deontic modality.

### Read the model back in English

A live FORML verbalization of the whole model. Click any sentence to select what it describes.

```text
Each Person works for exactly one Company.
In each population of "Person has Skill", each Person, Skill combination occurs at most once.
It is necessary that the possible values of GenderCode are {'M', 'F'}.
```

### Catch mistakes while you draw

Missing reference schemes, fact types without a uniqueness constraint, uniqueness constraints too
narrow to keep a fact type elementary, unattached roles, reading/arity mismatches, subtype cycles and
incompatible ring or set-comparison roles — reported in the Problems panel and highlighted on the
diagram.

### Map to a relational schema

Rmap-style mapping in the *Relational* tab, and SQL DDL for PostgreSQL, SQL Server, MySQL, SQLite or
ANSI SQL. Functional fact types are absorbed as columns, compound-unique fact types get their own
table, unaries become booleans, subtypes are absorbed into their supertype, and value constraints
become `CHECK` constraints.

### Map to a labeled property graph

![The Graph tab showing the LadybugDB mapping](media/screenshot-graph.png)

The same model, mapped to a property graph for **[LadybugDB](https://docs.ladybugdb.com/)**. ORM
carries more than a hand-drawn graph model does, and the mapping uses it:

- entity types become node tables, keyed by their reference mode;
- lexical value types become **properties**, and are promoted to nodes only when played
  many-to-many, where a single-valued property could not hold them;
- binary fact types become relationship tables whose **multiplicity is read off the uniqueness
  constraints** — a constraint on one role makes that end the "one" end;
- an n-ary fact type cannot be an edge, so it is **reified** into a node linked to each role player:
  the Levi (bipartite) form of the hyperedge the fact type really is.

```cypher
CREATE NODE TABLE Person(nr INT64 PRIMARY KEY, genderCode STRING);
CREATE REL TABLE WORKS_FOR(FROM Person TO Company, MANY_ONE);
CREATE REL TABLE HAS_STUDENT(FROM Enrolment TO Student, MANY_ONE);
```

LadybugDB enforces primary keys and multiplicities. Everything else ORM can state — mandatory roles,
value ranges, ring and set-comparison constraints — is carried into the script as verbalized comments
rather than quietly dropped:

```cypher
//   [mandatory] It is necessary that each Person works for some Company.
```

### Import from NORMA

`ORM: Import NORMA (.orm) File` reads NORMA / ORM 2 XML — objects, facts, readings, constraints,
subtypes, value restrictions and diagram geometry — and writes an `.orm.json` beside it.

### Export

SVG and PNG export of the diagram, plus force-directed auto-layout.

## Quick start

1. Run **ORM: New ORM Model** from the Command Palette and choose where to save it.
2. The diagram opens with a small example schema. Press `E` and click to add an entity type,
   `2` and click to add a binary fact type, then `C` and drag from a role box to an object type to
   connect them.
3. Click role boxes to select them, then use the constraint buttons in the toolbar (`U` uniqueness,
   `P` preferred identifier, `●` mandatory, and so on).
4. Watch the *Verbalization* tab to check the model says what you meant.

## Keyboard and mouse

| Action | Binding |
| --- | --- |
| Select tool / entity / value type | `V` / `E` / `T` |
| Unary / binary / ternary fact type | `1` / `2` / `3` |
| Subtype link / connect role | `S` / `C` |
| Zoom to fit | `F` |
| Auto-layout | `Ctrl/Cmd+Alt+L` |
| Delete selection | `Delete` |
| Undo / redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` |
| Pan / zoom | Middle-drag or drag empty canvas / wheel |
| Rename in place | Double-click a shape |
| Add to selection | `Shift`-click |

## Commands

| Command | Description |
| --- | --- |
| `ORM: New ORM Model` | Create a starter `.orm.json` and open the diagram |
| `ORM: Import NORMA (.orm) File` | Convert a NORMA ORM 2 XML file |
| `ORM: Verbalize Model` | Full FORML verbalization as Markdown |
| `ORM: Show Relational Mapping` | Mapped tables as a Markdown table |
| `ORM: Generate Relational Schema (SQL DDL)` | SQL DDL in a new editor |
| `ORM: Generate Property Graph Schema (LadybugDB)` | LadybugDB Cypher DDL in a new editor |
| `ORM: Export Diagram as SVG` / `as PNG` | Save the diagram as an image |
| `ORM: Auto-Layout Diagram` | Re-arrange the diagram |
| `ORM: Open Model Source (JSON)` | Open the model as text |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `orm.ddl.dialect` | `postgres` | SQL dialect for generated DDL |
| `orm.ddl.quoteIdentifiers` | `false` | Always quote generated identifiers |
| `orm.graph.subtypeStrategy` | `nodeTable` | `nodeTable` (own label + `IS_A`) or `absorb` |
| `orm.graph.ifNotExists` | `false` | Emit `IF NOT EXISTS` in the generated graph DDL |
| `orm.validation.enabled` | `true` | Report model problems in the Problems panel |
| `orm.verbalization.mode` | `forml` | `forml` or plainer English |
| `orm.diagram.snapToGrid` | `true` | Snap shapes to the grid |
| `orm.diagram.gridSize` | `10` | Grid size in pixels |
| `orm.diagram.showGrid` | `true` | Show the grid |

## File format

`*.orm.json` holds the conceptual schema and its diagram layout in one id-addressed structure:

```jsonc
{
  "version": 1,
  "name": "HR",
  "objectTypes": [
    { "id": "ot_person", "name": "Person", "kind": "entity", "refMode": "nr", "dataType": "integer" }
  ],
  "factTypes": [
    {
      "id": "ft_works",
      "roles": [
        { "id": "r1", "objectTypeId": "ot_person" },
        { "id": "r2", "objectTypeId": "ot_company" }
      ],
      "readings": [
        { "id": "rd1", "roleOrder": ["r1", "r2"], "text": "{0} works for {1}", "isPrimary": true }
      ]
    }
  ],
  "subtypeRelations": [],
  "constraints": [
    { "id": "uc1", "kind": "uniqueness", "roles": ["r1"] },
    { "id": "mc1", "kind": "mandatory", "roles": ["r1"] }
  ],
  "diagram": { "shapes": { "ot_person": { "x": 120, "y": 200 } } }
}
```

Readings use `{0}`, `{1}`, … placeholders indexing into `roleOrder`, the same convention NORMA uses.
The file is safe to hand-edit; the editor repairs missing collections on load. Because the diagram is
a custom editor over a text document, VS Code's dirty state, undo stack and file watching all work
normally — and `ORM: Open Model Source (JSON)` shows the text behind the picture at any time.

## Mapping rules

The relational mapping follows Rmap:

- a fact type whose only uniqueness constraint spans every role becomes its own table with a
  composite key;
- an n:1 or 1:1 fact type is absorbed as a column (or columns) into the table of the object type
  playing the uniquely-constrained role, on the mandatory side for 1:1;
- a unary fact type becomes a boolean column;
- mandatory roles produce `NOT NULL`, optional ones `NULL`;
- an entity type's reference mode expands into its identifying column; compound identifiers expand
  recursively, and an object type with no reference scheme gets a surrogate key plus a mapping note;
- objectified fact types map to their own table keyed by the objectified roles;
- subtypes are absorbed into their supertype's table with optional columns, and an exclusive subtype
  partition adds a discriminator column with a `CHECK`.

The property graph mapping starts from the same schema but answers a different question:

- an entity type becomes a node table, keyed by its reference mode, by a single-role preferred
  identifier over a value type, or — failing both — by a generated `SERIAL` key;
- a value type stays a property unless it is played many-to-many or in an n-ary fact type;
- a binary fact type becomes a relationship table with `MANY_ONE`, `ONE_MANY`, `ONE_ONE`, or
  `MANY_MANY` when only a spanning uniqueness constraint applies;
- a unary fact type becomes a `BOOLEAN` property;
- an n-ary or objectified fact type is reified into a node with one `MANY_ONE` relationship per role;
  role links to the same player share one relationship table with several `FROM ... TO ...` pairs.
  Objectify a fact type to name its node yourself;
- subtypes get their own label joined by `IS_A`, or are absorbed when `orm.graph.subtypeStrategy`
  is `absorb`.

Mapping notes explaining each choice appear beside the schema and as comments in the generated script.

## Known limitations

- The NORMA importer is one-way; models are saved as `.orm.json`, not written back to `.orm` XML.
- Derivation rules are stored and verbalized but not evaluated.
- The graph mapping targets LadybugDB's Cypher DDL. Other property graph databases will need small
  syntax adjustments.
- Sample populations and fact instances are not yet modeled.

## Documentation

The site includes a **[mini book on ORM 2](https://volland.github.io/factum-orm/book.html)** — ten
short chapters covering elementary facts, the constraint family, subtyping and objectification, and
Halpin's seven-step design procedure worked end to end. Every figure in it is rendered by the
extension's own renderer and links to the model file behind it, so any example can be opened and
taken apart in the editor. Regenerate the figures with `npm run figures`.

The full documentation site lives in [`docs/`](docs/) and is published with GitHub Pages:
[book](https://volland.github.io/factum-orm/book.html),
[getting started](https://volland.github.io/factum-orm/getting-started.html),
[mapping rules](https://volland.github.io/factum-orm/mapping.html),
[reference](https://volland.github.io/factum-orm/reference.html) and the
[file format](https://volland.github.io/factum-orm/file-format.html).

## Development

```bash
npm install
npm run compile      # bundle the extension and webview into out/
npm run watch        # rebuild on change
npm test             # model, verbalization, validation, mapping and rendering tests
npm run typecheck
npm run vsix         # build a .vsix package
```

Press `F5` to launch an Extension Development Host on the `examples/` folder.

The extension host code lives in `src/extension.ts` and `src/editor/`; the diagram runs in a webview
(`src/webview/`). Both share the model, verbalizer, validator and mappers in `src/model/` and
`src/core/`, which are plain TypeScript with no VS Code or DOM dependencies — which is why they are
straightforward to test and to reuse outside the editor.

## Credits

Object-Role Modeling is the work of Terry Halpin and the fact-oriented modeling community. Factum is
an independent implementation and is not affiliated with the ORM Foundation or the NORMA project.

## License

MIT.
