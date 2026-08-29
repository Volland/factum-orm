import { context, build } from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
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

const webviewConfig = {
  ...shared,
  entryPoints: ['src/webview/main.ts'],
  outfile: 'out/webview.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
};

if (watch) {
  const contexts = await Promise.all([context(extensionConfig), context(webviewConfig)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('watching…');
} else {
  await Promise.all([build(extensionConfig), build(webviewConfig)]);
}
