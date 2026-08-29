import { readFileSync } from 'node:fs';
import { context, build } from 'esbuild';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  // So the MCP server advertises the package's real version rather than a
  // literal that drifts every release.
  define: { __FACTUM_VERSION__: JSON.stringify(version) },
  minify: production,
  sourcemap: production ? false : 'inline',
  logLevel: 'info',
};

const extensionConfig = {
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'out/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
};

// The CLI and the MCP server bundle the same core the extension does; neither
// imports vscode, which is what makes them possible at all.
const cliConfig = {
  ...shared,
  entryPoints: ['src/cli/main.ts'],
  outfile: 'bin/factum.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
};

const mcpConfig = {
  ...shared,
  entryPoints: ['src/mcp/server.ts'],
  outfile: 'bin/factum-mcp.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
};

const webviewConfig = {
  ...shared,
  entryPoints: ['src/webview/main.ts'],
  outfile: 'out/webview.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
};

if (watch) {
  const contexts = await Promise.all([
    context(extensionConfig),
    context(webviewConfig),
    context(cliConfig),
    context(mcpConfig),
  ]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('watching…');
} else {
  await Promise.all([build(extensionConfig), build(webviewConfig), build(cliConfig), build(mcpConfig)]);
  // The bundles are executables.
  const { chmodSync } = await import('node:fs');
  for (const file of ['bin/factum.js', 'bin/factum-mcp.js']) chmodSync(file, 0o755);
}
