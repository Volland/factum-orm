# Tooling

The command line, the pull request check, the MCP server and the derivation of a model from example data — everything that follows from the model being a text file rather than a document inside an application.

These share the model, verbalizer, validator and mappers with the editor. Those modules deliberately import neither VS Code nor the DOM, which is what makes a second front end possible at all; see [[interop#Interoperability#The converters]] for the same argument applied to the file formats.

## The command line

[[src/cli/main.ts#run]] is a single binary, `factum`, over the same core the extension runs.

Its point is not convenience. A conceptual schema stored in a SQL database or an XML blob can only be checked by a person who has the tool open; one stored as text can be checked by a build. `validate --format github` emits workflow commands so problems annotate the diff, and `--exit-code` on the reporting commands lets a job fail on them.

`validate` exits 1 on a blocking error, 2 on a usage or IO failure, and 0 otherwise, so a shell can tell a broken model from a broken invocation.

## Verbalization diff

[[src/core/diff.ts#diffModels]] compares two models and reports the change as sentences.

A JSON diff of a `.orm.json` file is readable, but it is still a diff of arrays and ids. What a reviewer needs is what the model now *says*, so the comparison runs over the verbalization rather than the document.

Keying each line by element id and position is what makes a tightened constraint read as one changed sentence rather than an addition and a deletion — the difference between a reviewer seeing `"roles": ["r1"]` appear and seeing *"Each Person works for exactly one Company."*

The GitHub Action in `action.yml` runs the same comparison against the base branch and posts the result.

## Schema drift

[[src/core/drift.ts#detectDrift]] compares the schema a model maps to against one that already exists, and emits the statements that would reconcile them.

The existing schema is read from SQL text — a dump, a migration — rather than from a live connection, so the check needs no database drivers and runs anywhere a file does. [[src/core/drift.ts#parseSqlSchema]] understands `CREATE TABLE` and nothing else, which is all the comparison needs; anything it does not recognise is skipped rather than guessed at.

The subtlety is in reading a column type: a type can contain spaces (`double precision`, `timestamp with time zone`), so the parser cuts at the first column-constraint keyword and reads the size out of what is left, rather than stopping at the first space.

## The skill pack

The `agent-skills/` directory carries two skills and ten slash commands distilled from the book, and [[src/cli/skills.ts#commandSkills]] installs them into a coding agent.

Nothing is converted on the way in. Claude Code, Cursor, the Codex CLI and OpenCode all read `<root>/skills/<name>/SKILL.md`, so what differs is the root and whether the slash commands travel with the skills. [[src/cli/skills.ts#SKILL_TARGETS]] is that table, and `--dir` covers anything not in it.

Two entries in it are not what they look like. OpenCode is configured under `~/.config/opencode` rather than `~/.opencode`, which is where its binary lives; and Cursor reserves `~/.cursor/skills-cursor` for the skills it ships itself, so a personal skill belongs in `~/.cursor/skills`. Only Claude Code and Cursor read the pack's slash commands, and for the other two the commands are left out rather than written somewhere nothing reads — the same procedures are in the skills.

Two details are load-bearing. A skill is a *directory* — a `SKILL.md` beside the references and example models it points at — so the copy is recursive or the skill arrives broken. And an install never overwrites: a user may have edited a skill, so what is already there is reported and left, and `--force` is the way to say otherwise.

The pack is ordinary markdown in the repository rather than a generated artifact, which is why it also works as a Claude Code plugin directory as it stands.

## The MCP server

[[src/mcp/server.ts#createServer]] exposes the model to an agent as tools over stdio.

The competitive move is not to add AI to a modelling tool but to stop being the thing the agent has to be told about. Factum already runs in the editor the agent works in, so rather than growing a chat panel it hands the agent the model: read it, verbalize it, check it, map it, compare it.

This is also the product's stated position — *human-first, AI-native*. An elementary fact is the smallest artifact a domain expert and a language model can both check, so the verbalization a business analyst approves is the same text an agent reasons over. Nothing here calls a language model; the verbalizer, validator and mappers stay deterministic, and the agent is the caller rather than a dependency.

Every tool is read-only except `apply_model`, which validates before writing and refuses a model with blocking errors unless explicitly overridden. An agent cannot save a broken schema by accident.

## Deriving a model from examples

[[src/core/derive.ts#deriveModel]] turns a table of examples into a first-draft schema — step one of both Halpin's design procedure and FCO-IM, where the facts come before the model.

Nothing here guesses beyond what the data shows: a constraint is proposed only when every row supports it, and each assumption comes back as a note for the modeller to confirm.

Two decisions keep the draft honest. An identifying column becomes the entity's **reference mode**, not a fact type of its own — `Employee(.nr)` rather than a redundant `Employee has EmployeeNr` — and the entity's own name is stripped from the mode, following the ORM convention. And a column whose values are all distinct is only proposed as unique above [[src/core/derive.ts#UNIQUENESS_EVIDENCE]] rows, because across three rows that is coincidence rather than evidence.
