import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli/main.js';
import { createServer } from '../src/mcp/server.js';
import { serializeModel } from '../src/model/model.js';
import { sampleModel } from '../src/model/sample.js';

const dir = mkdtempSync(join(tmpdir(), 'factum-cli-'));

function write(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

/** Runs the CLI, capturing what it writes so the output can be asserted on. */
function capture(argv: string[]): { code: number; out: string; err: string } {
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  process.stdout.write = ((chunk: string) => { out += chunk; return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => { err += chunk; return true; }) as typeof process.stderr.write;
  try {
    return { code: run(argv), out, err };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}

const modelPath = write('model.orm.json', serializeModel(sampleModel()));

// @lat: [[tests#Command line#Validate succeeds on a clean model]]
test('validate exits zero on a clean model and reports the population size', () => {
  const { code, out } = capture(['validate', modelPath]);
  assert.equal(code, 0);
  assert.match(out, /sample fact/);
});

// @lat: [[tests#Command line#Validate exits non-zero on a broken model]]
test('validate exits non-zero when the model has a blocking error', () => {
  const broken = sampleModel();
  broken.factTypes[0].roles[0].objectTypeId = null;
  const path = write('broken.orm.json', serializeModel(broken));
  assert.equal(capture(['validate', path]).code, 1);
});

// @lat: [[tests#Command line#Validate emits workflow commands for CI]]
test('validate --format github emits workflow commands a build can annotate with', () => {
  const broken = sampleModel();
  broken.factTypes[0].roles[0].objectTypeId = null;
  const path = write('broken2.orm.json', serializeModel(broken));
  const { out } = capture(['validate', path, '--format', 'github']);
  assert.match(out, /^::error file=/m);
});

// @lat: [[tests#Command line#Diff can fail a build when the model changed]]
test('diff --exit-code exits non-zero only when the model says something new', () => {
  const other = sampleModel();
  other.objectTypes.find((o) => o.id === 'ot_skill')!.name = 'Competency';
  const otherPath = write('other.orm.json', serializeModel(other));
  assert.equal(capture(['diff', modelPath, modelPath, '--exit-code']).code, 0);
  const changed = capture(['diff', modelPath, otherPath, '--exit-code']);
  assert.equal(changed.code, 1);
  assert.match(changed.out, /Competency/);
});

// @lat: [[tests#Command line#Derive builds a model from a CSV]]
test('derive turns a CSV into a model file', () => {
  const csv = write('people.csv', 'nr,name\n1,Ada\n2,Grace\n');
  const target = join(dir, 'people.orm.json');
  const { code } = capture(['derive', csv, '--name', 'person', '-o', target]);
  assert.equal(code, 0);
  const written = JSON.parse(readFileSync(target, 'utf8'));
  assert.equal(written.objectTypes[0].name, 'Person');
  assert.equal(written.objectTypes[0].refMode, 'nr');
});

// @lat: [[tests#Command line#Convert reaches the interchange formats]]
test('convert writes any of the interchange formats', () => {
  const { out } = capture(['convert', modelPath, '--to', 'fbm']);
  assert.match(out, /<FactType/);
  const ossie = capture(['convert', modelPath, '--to', 'ossie']);
  assert.match(ossie.out, /^ontology:/m);
});

// @lat: [[tests#Command line#An unknown command explains itself]]
test('an unknown command prints the usage instead of a stack trace', () => {
  const { code, err } = capture(['frobnicate']);
  assert.equal(code, 1);
  assert.match(err, /Unknown command/);
});

// @lat: [[tests#Command line#A missing file is an error, not a crash]]
test('a missing file is reported as an error rather than crashing', () => {
  const { code, err } = capture(['validate', join(dir, 'nope.orm.json')]);
  assert.equal(code, 2);
  assert.match(err, /Cannot read/);
});

// @lat: [[tests#Command line#The MCP server exposes the model tools]]
test('the MCP server registers the tools an agent needs to work on a model', () => {
  const server = createServer();
  // The registry is the contract with the agent; assert the names, not the SDK.
  const names = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
  for (const expected of [
    'read_model',
    'verbalize_model',
    'validate_model',
    'generate_schema',
    'diff_models',
    'detect_drift',
    'read_population',
    'apply_model',
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}; got ${names.join(', ')}`);
  }
});
