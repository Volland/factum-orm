# Publishing checklist

Everything below is repo-only; none of it ships to users. Work top to bottom.

## 1. Push the repository

The manifest points at `https://github.com/Volland/factum-orm`, matching the `origin` remote, and the
Marketplace homepage points at `https://www.factum-orm.com/`.

Push `main` — **including `media/`** — before publishing. `vsce` rewrites the relative image paths in
`README.md` (`media/screenshot-diagram.png`, `media/screenshot-graph.png`) to raw URLs under this
repository, so the screenshots on the Marketplace listing only resolve once those files exist on the
default branch.

## 2. Turn on GitHub Pages

The documentation site is committed as plain static files in `docs/` — no build step and no CI.
In the repository: **Settings → Pages → Build and deployment → Deploy from a branch**, then pick
`main` and the `/docs` folder. The site appears at `https://<user>.github.io/factum-orm/`.

`docs/.nojekyll` is already present so Pages serves the files as-is instead of running Jekyll.

## 3. Create the publisher

The manifest publishes as `pavlyshyn`. Create it once at
<https://marketplace.visualstudio.com/manage>, then:

```bash
npx vsce login pavlyshyn      # paste a Personal Access Token from Azure DevOps
```

The PAT needs **Marketplace → Manage** scope and must be scoped to *all accessible organizations*.

## 4. Decide on the preview flag

`"preview": true` marks the listing as a preview release, which is honest for `0.1.0`. Remove it when
you consider the extension stable.

## 4b. Rebuild the committed bundles

`bin/factum.js` and `bin/factum-mcp.js` are **committed build artifacts**, not ignored output: the
GitHub Action in `action.yml` runs `bin/factum.js` from `$GITHUB_ACTION_PATH`, which only works if
the built file is in the repository. This is the usual arrangement for a JavaScript action.

Run the production build and commit the result *before* tagging, or the action ships stale:

```bash
npm run package     # minified bundles into out/ and bin/
git add bin out
```

## 5. Verify the package

```bash
npm run typecheck && npm test
npm run vsix
npx vsce ls --no-dependencies    # confirm the file list
```

Install the built `.vsix` locally and click through the diagram, the Verbalization, Relational and
Graph tabs, and both generate commands before publishing:

```bash
code --install-extension factum-orm-0.4.0.vsix
```

## 6. Publish

```bash
npx vsce publish              # or: npx vsce publish minor
```

Add `--pre-release` if you want the pre-release channel instead of a normal release.

## Optional polish

- **Badges.** Once the extension is live, add to the top of `README.md`:
  `![Version](https://img.shields.io/visual-studio-marketplace/v/pavlyshyn.factum-orm)` and the
  matching `/i/` (installs) and `/r/` (rating) badges. They 404 until the first publish, which is why
  they are not there yet.
- **npm.** The CLI and the MCP server are only useful once they are on a user's `PATH`, which means
  publishing the package to npm. The name `factum-orm` is unclaimed. `.npmignore` is already set up
  to ship `bin/`, `out/` and `schema/` only:

  ```bash
  npm login
  npm publish --access public
  ```

  Until this is done, `factum` and `factum-mcp` ship inside the `.vsix` but are not installable
  as commands.
- **Open VSX.** For VSCodium, Cursor and Windsurf users, mirror the release with
  `npx ovsx publish factum-orm-0.4.0.vsix -p <token>`.
- **A short GIF** of drawing a fact type and watching the verbalization update would carry the
  listing further than the two static screenshots.
