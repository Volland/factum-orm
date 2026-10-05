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
code --install-extension factum-orm-0.6.1.vsix
```

## 6. Publish

```bash
npx vsce publish              # or: npx vsce publish minor
```

Add `--pre-release` if you want the pre-release channel instead of a normal release.

## 7. Mirror to Open VSX

The Microsoft Marketplace is only reachable from Microsoft's own builds of VS Code. VSCodium, Cursor,
Windsurf, Gitpod and Eclipse Theia all resolve extensions from [Open VSX](https://open-vsx.org)
instead, so a release that skips it is invisible to every one of them.

Open VSX takes the **same `.vsix`** — there is nothing to rebuild and no second manifest.

Get a token from <https://open-vsx.org/user-settings/tokens> (log in with GitHub, then
*Access Tokens → Generate New Token*).

The `pavlyshyn` namespace is **already claimed and verified** — it carries `lpg-modeler` and
`typegraph-vscode` — so there is nothing to create. A namespace must match `publisher` in the
manifest, and for a new one the command is `npx --yes ovsx create-namespace <name>`; running it on an
existing namespace fails rather than doing nothing.

Publish the package `npm run vsix` already built:

```bash
npm run publish:ovsx                           # reads $OVSX_PAT
```

That script is `ovsx publish factum-orm-<version>.vsix`, so it always ships the version in the
manifest. To publish a `.vsix` you already have without rebuilding:

```bash
npx --yes ovsx publish factum-orm-0.6.1.vsix -p <token>
```

Prefer `$OVSX_PAT` over `-p`: a token on the command line lands in your shell history.

The listing appears at <https://open-vsx.org/extension/pavlyshyn/factum-orm>, which is the URL the
documentation site links to. Open VSX enforces the same rule npm does — a version number is
permanent — so bump rather than republish.

Open VSX also requires that the publisher agree to its
[publisher agreement](https://open-vsx.org/about) on first publish; `ovsx` prints the link if it is
outstanding.

## Optional polish

- **Badges.** Once the extension is live, add to the top of `README.md`:
  `![Version](https://img.shields.io/visual-studio-marketplace/v/pavlyshyn.factum-orm)` and the
  matching `/i/` (installs) and `/r/` (rating) badges. They 404 until the first publish, which is why
  they are not there yet.
- **npm.** Publishing to npm is what puts `factum` and `factum-mcp` on a user's `PATH`; inside the
  `.vsix` they ship but are not installable as commands. `factum-orm` is already published and owned
  by `vpavlyshyn`, so a release is just:

  ```bash
  npm whoami                    # expect: vpavlyshyn
  npm pack --dry-run            # confirm the file list before burning a version
  npm publish                   # --access public only matters for a scoped name
  ```

  `prepublishOnly` runs `npm run package` first, so the bundles are always rebuilt. `.npmignore`
  ships `bin/`, `out/`, `schema/`, `media/logo/`, `action.yml` and the docs — around 400 kB.

  A published version number is permanent: npm allows unpublishing only within 72 hours, and never
  allows reusing the number. Bump rather than republish.
- **A short GIF** of drawing a fact type and watching the verbalization update would carry the
  listing further than the two static screenshots.
