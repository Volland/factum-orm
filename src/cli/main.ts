/**
 * The `factum` command line, and the reason the file format is text.
 *
 * Everything here runs the same model, verbalizer, validator and mappers the
 * editor does — those modules deliberately have no VS Code or DOM imports — so
 * a conceptual schema can be checked by a build rather than only by a person
 * who happens to have the extension installed.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { generateDdl, SqlDialect } from '../core/ddl.js';
import { deriveModel, parseDelimited, tableFromRows } from '../core/derive.js';
import { diffModels, formatDiffAsMarkdown, formatDiffAsText, isUnchanged } from '../core/diff.js';
import { detectDrift, formatDriftAsMarkdown } from '../core/drift.js';
import { generateGraphDdl } from '../core/graphDdl.js';
import { mapToGraph } from '../core/lpg.js';
import { verbalizeAllPopulations } from '../core/population.js';
import { mapToRelational } from '../core/rmap.js';
import { hasBlockingErrors, Issue, summarize, validateModel } from '../core/validate.js';
import { verbalizeModelAsText } from '../core/verbalize.js';
import { parseModel, populationSize, serializeModel } from '../model/model.js';
import { OrmModel } from '../model/types.js';
import { exportFbmFile, importFbmFile } from '../io/fbm.js';
import { detectFormat, ExportResult, FORMAT_INFO, ImportResult, InteropFormat } from '../io/interop.js';
import { exportNormaFile } from '../io/normaExport.js';
import { importNormaFile } from '../io/normaImport.js';
import { exportOssieFile, importOssieFile } from '../io/ossie.js';
import { exportUmsFile, importUmsFile } from '../io/ums.js';
import { commandSkills } from './skills.js';

const USAGE = `factum — Object-Role Modeling from the command line

Usage
  factum validate <model.orm.json> [--strict] [--format text|json|github]
  factum verbalize <model.orm.json> [--mode forml|plain] [--population]
  factum ddl <model.orm.json> [--dialect postgres|sqlserver|mysql|sqlite|ansi] [-o file]
  factum graph <model.orm.json> [--subtypes nodeTable|absorb] [-o file]
  factum diff <before.orm.json> <after.orm.json> [--format text|markdown] [--exit-code]
  factum drift <model.orm.json> <schema.sql> [--dialect …] [--ignore-extra] [--exit-code]
  factum convert <input> [-o output] [--to norma|fbm|ossie|ums]
  factum derive <table.csv> [--name Employee] [--delimiter ,] [-o model.orm.json]
  factum skills list
  factum skills install [--target claude|cursor|codex|opencode] [--global|--local] [--dir <path>]

Options
  --exit-code   exit 1 when there is something to report, for use in CI
  --strict      treat warnings as errors
  -o, --output  write to a file instead of standard output
  --target      which agent to install skills for: claude, cursor, codex, opencode
  --global      install for every project; --local for this one only
  --force       replace skills and commands that are already installed
  --dry-run     report what would be installed without writing anything
  -h, --help    show this message
`;

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }
    const name = arg.replace(/^--?/, '');
    const alias: Record<string, string> = { o: 'output', h: 'help' };
    const key = alias[name] ?? name;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }
  return { command: positional.shift() ?? '', positional, flags };
}

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Cannot read "${path}".`);
  }
}

function loadModel(path: string): OrmModel {
  const text = read(path);
  if (path.toLowerCase().endsWith('.json')) return parseModel(text);
  // A convenience: point any command at an interchange file and it is converted.
  const format = detectFormat(path, text);
  if (!format) throw new Error(`Cannot tell what format "${basename(path)}" is.`);
  return READERS[format](text).model;
}

const READERS: Record<InteropFormat, (text: string) => ImportResult> = {
  norma: importNormaFile,
  fbm: importFbmFile,
  ossie: importOssieFile,
  ums: importUmsFile,
};

const WRITERS: Record<InteropFormat, (model: OrmModel) => ExportResult> = {
  norma: exportNormaFile,
  fbm: exportFbmFile,
  ossie: exportOssieFile,
  ums: exportUmsFile,
};

function emit(text: string, args: Args): void {
  const output = args.flags.get('output');
  if (typeof output === 'string') {
    writeFileSync(output, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    process.stderr.write(`Wrote ${output}\n`);
  } else {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  }
}

function requirePath(args: Args, position: number, what: string): string {
  const path = args.positional[position];
  if (!path) throw new Error(`Expected ${what}. Run \`factum --help\` for usage.`);
  return path;
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

/** GitHub Actions reads these from stdout and annotates the run. */
function asWorkflowCommands(issues: Issue[], path: string): string {
  return issues
    .map((issue) => {
      const level = issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'notice';
      const message = issue.message.replace(/\r?\n/g, ' ');
      return `::${level} file=${path},title=${issue.code}::${message}`;
    })
    .join('\n');
}

function commandValidate(args: Args): number {
  const path = requirePath(args, 0, 'a model file');
  const model = loadModel(path);
  const issues = validateModel(model);
  const strict = args.flags.has('strict');
  const format = args.flags.get('format') ?? 'text';

  if (format === 'json') {
    emit(JSON.stringify({ path, issues, summary: summarize(issues) }, undefined, 2), args);
  } else if (format === 'github') {
    if (issues.length) emit(asWorkflowCommands(issues, path), args);
  } else {
    const lines = issues.map((i) => `${i.severity.padEnd(7)} ${i.code.padEnd(34)} ${i.message}`);
    lines.push('', `${summarize(issues)} ${populationSize(model)} sample fact(s).`);
    emit(lines.join('\n'), args);
  }

  if (hasBlockingErrors(issues)) return 1;
  return strict && issues.length ? 1 : 0;
}

function commandVerbalize(args: Args): number {
  const path = requirePath(args, 0, 'a model file');
  const model = loadModel(path);
  const mode = args.flags.get('mode') === 'plain' ? 'plain' : 'forml';
  let text = verbalizeModelAsText(model, { mode });

  if (args.flags.has('population')) {
    // The Substitution Principle: read the examples back through the readings.
    const sections = verbalizeAllPopulations(model);
    if (sections.length) {
      text += '\n## Sample population\n\n';
      for (const section of sections) {
        text += section.sentences.map((s) => `- ${s}`).join('\n');
        text += '\n';
      }
    }
  }
  emit(text, args);
  return 0;
}

function commandDdl(args: Args): number {
  const path = requirePath(args, 0, 'a model file');
  const model = loadModel(path);
  const dialect = (args.flags.get('dialect') ?? 'postgres') as SqlDialect;
  emit(generateDdl(mapToRelational(model), { dialect }), args);
  return 0;
}

function commandGraph(args: Args): number {
  const path = requirePath(args, 0, 'a model file');
  const model = loadModel(path);
  const subtypeStrategy = args.flags.get('subtypes') === 'absorb' ? 'absorb' : 'nodeTable';
  emit(generateGraphDdl(mapToGraph(model, { subtypeStrategy })), args);
  return 0;
}

function commandDiff(args: Args): number {
  const before = loadModel(requirePath(args, 0, 'the earlier model'));
  const after = loadModel(requirePath(args, 1, 'the later model'));
  const diff = diffModels(before, after);
  const markdown = args.flags.get('format') === 'markdown';
  emit(markdown ? formatDiffAsMarkdown(diff) : formatDiffAsText(diff), args);
  return args.flags.has('exit-code') && !isUnchanged(diff) ? 1 : 0;
}

function commandDrift(args: Args): number {
  const model = loadModel(requirePath(args, 0, 'a model file'));
  const sql = read(requirePath(args, 1, 'a SQL schema file'));
  const report = detectDrift(model, sql, {
    dialect: (args.flags.get('dialect') ?? 'postgres') as SqlDialect,
    ignoreExtraTables: args.flags.has('ignore-extra'),
  });
  emit(formatDriftAsMarkdown(report), args);
  return args.flags.has('exit-code') && report.items.length ? 1 : 0;
}

function commandConvert(args: Args): number {
  const path = requirePath(args, 0, 'an input file');
  const model = loadModel(path);
  const to = args.flags.get('to');

  if (typeof to === 'string') {
    if (!(to in FORMAT_INFO)) {
      throw new Error(`Unknown format "${to}". Choose one of ${Object.keys(FORMAT_INFO).join(', ')}.`);
    }
    const result = WRITERS[to as InteropFormat](model);
    for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
    emit(result.text, args);
    return 0;
  }
  emit(serializeModel(model), args);
  return 0;
}

function commandDerive(args: Args): number {
  const path = requirePath(args, 0, 'a delimited data file');
  const delimiter = typeof args.flags.get('delimiter') === 'string' ? String(args.flags.get('delimiter')) : ',';
  const name = typeof args.flags.get('name') === 'string'
    ? String(args.flags.get('name'))
    : basename(path).replace(/\.[^.]+$/, '');
  const { model, notes } = deriveModel(tableFromRows(name, parseDelimited(read(path), delimiter)));
  for (const note of notes) process.stderr.write(`note: ${note}\n`);
  emit(serializeModel(model), args);
  return 0;
}

const COMMANDS: Record<string, (args: Args) => number> = {
  validate: commandValidate,
  verbalize: commandVerbalize,
  ddl: commandDdl,
  graph: commandGraph,
  diff: commandDiff,
  drift: commandDrift,
  convert: commandConvert,
  derive: commandDerive,
  skills: commandSkills,
};

export function run(argv: string[]): number {
  const args = parseArgs(argv);
  if (!args.command || args.flags.has('help')) {
    process.stdout.write(USAGE);
    return args.command ? 0 : 1;
  }
  const command = COMMANDS[args.command];
  if (!command) {
    process.stderr.write(`Unknown command "${args.command}".\n\n${USAGE}`);
    return 1;
  }
  try {
    return command(args);
  } catch (error) {
    process.stderr.write(`error: ${(error as Error).message}\n`);
    return 2;
  }
}

/* c8 ignore next 3 */
if (process.argv[1] && /factum(\.[cm]?js)?$/.test(process.argv[1])) {
  process.exit(run(process.argv.slice(2)));
}
