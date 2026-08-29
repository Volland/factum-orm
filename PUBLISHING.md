# Publishing checklist

Everything below is repo-only; none of it ships to users. Work top to bottom.

## 1. Replace the placeholder repository URL

`package.json` currently points at a placeholder. Replace `USERNAME` in all three fields:

```json
"repository": { "type": "git", "url": "https://github.com/USERNAME/factum-orm.git" },
"homepage": "https://github.com/USERNAME/factum-orm#readme",
"bugs": { "url": "https://github.com/USERNAME/factum-orm/issues" }
```

This matters more than it looks: `vsce` rewrites the relative image paths in `README.md`
(`media/screenshot-diagram.png`, `media/screenshot-graph.png`) to raw URLs under this repository.
Until the URL is real, **the screenshots will not render on the Marketplace listing**.

Push the repo — including `media/` — before publishing, so those raw URLs resolve.

## 2. Create the publisher

The manifest publishes as `pavlyshyn`. Create it once at
<https://marketplace.visualstudio.com/manage>, then:

```bash
npx vsce login pavlyshyn      # paste a Personal Access Token from Azure DevOps
```

The PAT needs **Marketplace → Manage** scope and must be scoped to *all accessible organizations*.

## 3. Decide on the preview flag

`"preview": true` marks the listing as a preview release, which is honest for `0.1.0`. Remove it when
you consider the extension stable.

## 4. Verify the package

```bash
npm run typecheck && npm test
npm run vsix
npx vsce ls --no-dependencies    # confirm the file list
```

Install the built `.vsix` locally and click through the diagram, the Verbalization, Relational and
Graph tabs, and both generate commands before publishing:

```bash
code --install-extension factum-orm-0.1.0.vsix
```

## 5. Publish

```bash
npx vsce publish              # or: npx vsce publish minor
```

Add `--pre-release` if you want the pre-release channel instead of a normal release.

## Optional polish

- **Badges.** Once the extension is live, add to the top of `README.md`:
  `![Version](https://img.shields.io/visual-studio-marketplace/v/pavlyshyn.factum-orm)` and the
  matching `/i/` (installs) and `/r/` (rating) badges. They 404 until the first publish, which is why
  they are not there yet.
- **Open VSX.** For VSCodium, Cursor and Windsurf users, mirror the release with
  `npx ovsx publish factum-orm-0.1.0.vsix -p <token>`.
- **A short GIF** of drawing a fact type and watching the verbalization update would carry the
  listing further than the two static screenshots.
