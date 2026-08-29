This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

- [[file-format]] — the `.orm.json` envelope, its metadata, generation hints and extension rules.
- [[interop]] — how the format compares with NORMA, FBM, UMS and Apache Ossie, and what was adopted from each.
- [[tooling]] — the CLI, the pull request check, the MCP server and derivation from example data.
- [[tests]] — specifications for the format, hint, interchange and tooling tests.
