# Reading, drawing and laying out an ORM 2 diagram

## The three shapes

- **Soft-cornered box, solid outline — an entity type.** A thing in the world that
  needs to be referred to. Under the name in parentheses is its reference mode:
  `Person(.nr)` means *a Person is referred to by a number*.
- **Soft-cornered box, dashed outline — a value type.** Lexical; it denotes itself.
  `EmpName` is a string, and there is nothing behind it.
- **A row of small rectangles — a fact type.** One rectangle per role. One is a unary,
  two a binary, three a ternary. The reading is written beside it.

A line from an object type to a role box says which object type plays that role. That
is the entire structural vocabulary. **Everything else on the diagram is a
constraint.** An `!` after a name marks an independent object type.

## Read it aloud

The single most useful habit: read a fact type as a sentence with an instance in it.
Not *"Person has a relationship to Company"* but *"Person 101 works for Acme"*. This
is not a mnemonic — it is the validation procedure. Two readings of one fact type
(`Academic works for Dept` / `Dept employs Academic`) give the domain expert a second
chance to spot an error, because they read it from the end they think about it from.

## The marks

| Mark | Constraint |
| --- | --- |
| Purple dot where a connector meets a box | mandatory — every instance plays this role |
| Bar over one or more role boxes | internal uniqueness — **the bar covers what is unique** |
| Bar in a circle, dashed lines to roles | external uniqueness, across fact types |
| Dashed bar with `n..m` | frequency |
| Circled glyph with dashed lines (⊆, ⊗, =) | subset, exclusion, equality — the subset arrow points **from** subset **to** superset |
| Ring glyph on a self-relation | ring constraint |
| Solid arrow from subtype box to supertype box | subtype relation |
| Rounded frame around a fact type, with a name | objectification |
| `{'P', 'SL', 'L'}` beside a box or role | value constraint |
| Dashed constraint mark instead of solid | deontic modality |

The dashed lines from a circled glyph are **not relationships** — they are the
constraint pointing at what it constrains. That notational device is what lets ORM
state cross-fact-type rules a table diagram has no place for.

### The one misreading to avoid

Two separate bars, one over each role of a binary, is **1:1**. One bar spanning both
roles is **m:n** — only the pair is unique, the weakest constraint available. Same two
role boxes, same two strokes of ink, opposite meanings.

## Laying out the diagram

The diagram is the `diagram.shapes` block: `{ "<id>": { "x": …, "y": …,
"orientation": "horizontal" | "vertical", "hidden": true } }`, keyed by object type,
fact type, constraint or subtype-relation id. `x`/`y` are the top-left corner in
diagram units. Getting this right is most of what "drawing an ORM diagram" means.

**Hub and spoke.** Most models have one busy object type. Put it on the left, stack
its value types in a column on the right, and run the fact types between them.

```json
"academic": { "x": 40,  "y": 210 },
"empname":  { "x": 430, "y": 20  },
"dept":     { "x": 430, "y": 90  },
"room":     { "x": 430, "y": 160 },
"named":    { "x": 280, "y": 28,  "orientation": "horizontal" },
"works":    { "x": 280, "y": 98,  "orientation": "horizontal" },
"occupies": { "x": 280, "y": 168, "orientation": "horizontal" }
```

Rules of thumb that produce a legible figure:

- **70 units between rows.** Enough for a box plus its reading line.
- **A fact type sits ~8 units below its right-hand partner's `y`,** so the connector
  runs flat.
- **240–260 units between the hub and the column,** with the fact type at roughly the
  midpoint (`x: 280` between `40` and `430`).
- **`orientation: "horizontal"` for a fact type whose players sit side by side,
  `"vertical"` when they sit above and below** — a subtype column, or a self-relation.
- **Subtypes go directly below their supertype** (`person` at `y: 30`, `student` at
  `y: 170`) so the arrow is vertical and short.
- **An objectified fact type's own facts go above it**, so the frame does not collide
  with the fact type's connectors.
- **Circled constraint glyphs get their own shape entry**, placed between the two
  roles they span (an exclusion over rows at `y: 308` and `y: 378` goes near
  `y: 348`).
- Keep a figure under about 600 units wide if it has to fit a page or a slide. Long
  readings are what overflow — shorten the reading, not the layout.

**Or do not lay it out by hand.** `ORM: Auto-Layout Diagram` (`Ctrl/Cmd+Alt+L`) in the
editor produces something legible; hand-placement is for figures you will publish.

## Rendering

The renderer draws standard ORM 2 notation from the model — there is nothing to draw
by hand and no separate diagram file to keep in sync.

- **Editor:** `ORM: Export Diagram as SVG` / `as PNG`, `ORM: Auto-Layout Diagram`,
  `ORM: Open Model Source (JSON)`.
- **Keyboard while drawing:** `V` select, `E` entity type, `T` value type, `1`/`2`/`3`
  unary/binary/ternary, `S` subtype link, `C` connect role, `F` zoom to fit,
  double-click to rename in place — typing `Person(.nr)` sets name and reference mode
  at once.
- **Batch:** the extension's renderer is scriptable from Node
  (`out-test/src/webview/render.js` exports `renderDiagram` and `diagramBounds`,
  `autolayout.js` exports `autoLayout`), which is how a book or a docs site renders
  every figure from its model file. Rasterise the SVG with `rsvg-convert`.

If the user only needs the *meaning* checked rather than a picture, `factum verbalize`
is faster than rendering and easier to review.
