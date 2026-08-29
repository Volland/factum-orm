/**
 * An MCP server over a `.orm.json` model.
 *
 * The competitive move here is not "add AI to the modelling tool" — it is to
 * stop being the thing the agent has to be told about. Factum already lives in
 * the editor the agent works in, so rather than growing a chat panel, it hands
 * the agent the model: read it, verbalize it, check it, propose against it.
 *
 * Every tool is read-only except `apply_model`, which writes a whole model back
 * after validating it. Nothing here mutates a file as a side effect of a query.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { generateDdl, SqlDialect } from '../core/ddl.js';
import { diffModels, formatDiffAsText } from '../core/diff.js';
import { detectDrift, formatDriftAsMarkdown } from '../core/drift.js';
import { generateGraphDdl } from '../core/graphDdl.js';
import { mapToGraph } from '../core/lpg.js';
import { verbalizeAllPopulations } from '../core/population.js';
import { mapToRelational } from '../core/rmap.js';
import { summarize, validateModel } from '../core/validate.js';
import { verbalizeModelAsText } from '../core/verbalize.js';
import { parseModel, populationSize, primaryReading, serializeModel } from '../model/model.js';
import { OrmModel } from '../model/types.js';

function loadModel(path: string): OrmModel {
  return parseModel(readFileSync(resolve(path), 'utf8'));
}

function text(value: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: value }] };
}

/**
 * A compact description of the model, for an agent that needs to know what the
 * model says without reading several hundred lines of JSON.
 */
function outline(model: OrmModel): string {
  const lines: string[] = [
    `# ${model.name}`,
    '',
    `${model.objectTypes.length} object types, ${model.factTypes.length} fact types, ${model.constraints.length} constraints, ${model.subtypeRelations.length} subtype relations, ${populationSize(model)} sample facts.`,
    '',
    '## Object types',
  ];
  for (const ot of model.objectTypes) {
    const ref = ot.kind === 'entity' && ot.refMode ? `(.${ot.refMode})` : '';
    const type = ot.kind === 'value' ? ` : ${ot.dataType ?? 'string'}` : '';
    const description = ot.meta?.description ? ` — ${ot.meta.description}` : '';
    lines.push(`- ${ot.name}${ref}${type} [${ot.id}]${description}`);
  }
  lines.push('', '## Fact types');
  for (const ft of model.factTypes) {
    const reading = primaryReading(ft);
    const players = ft.roles
      .map((r) => model.objectTypes.find((o) => o.id === r.objectTypeId)?.name ?? '?')
      .join(', ');
    lines.push(`- ${reading?.text ?? '(no reading)'} over (${players}) [${ft.id}]`);
  }
  if (model.subtypeRelations.length) {
    lines.push('', '## Subtypes');
    for (const s of model.subtypeRelations) {
      const sub = model.objectTypes.find((o) => o.id === s.subtypeId)?.name ?? s.subtypeId;
      const sup = model.objectTypes.find((o) => o.id === s.supertypeId)?.name ?? s.supertypeId;
      lines.push(`- ${sub} is a ${sup}`);
    }
  }
  return lines.join('\n');
}

/** Injected from package.json at build time; falls back when run from source. */
declare const __FACTUM_VERSION__: string | undefined;

export function createServer(): McpServer {
  const version = typeof __FACTUM_VERSION__ === 'string' ? __FACTUM_VERSION__ : '0.0.0-dev';
  const server = new McpServer({ name: 'factum', version });

  server.registerTool(
    'read_model',
    {
      title: 'Read an ORM model',
      description:
        'Summarise a .orm.json model: its object types, fact types, readings, subtypes and counts. Use this before answering anything about what the domain looks like. Pass full=true only when you need the raw JSON.',
      inputSchema: {
        path: z.string().describe('Path to the .orm.json file'),
        full: z.boolean().optional().describe('Return the whole document instead of an outline'),
      },
    },
    async ({ path, full }) => {
      const model = loadModel(path);
      return text(full ? serializeModel(model) : outline(model));
    },
  );

  server.registerTool(
    'verbalize_model',
    {
      title: 'Read the model back as English',
      description:
        'The FORML verbalization of a model: every fact type and constraint as a sentence a domain expert can confirm or reject. This is the best way to check that a model says what someone meant.',
      inputSchema: {
        path: z.string().describe('Path to the .orm.json file'),
        mode: z.enum(['forml', 'plain']).optional(),
        population: z.boolean().optional().describe('Also read the sample facts back as sentences'),
      },
    },
    async ({ path, mode, population }) => {
      const model = loadModel(path);
      let out = verbalizeModelAsText(model, { mode: mode ?? 'forml' });
      if (population) {
        for (const section of verbalizeAllPopulations(model)) {
          out += `\n${section.sentences.map((s) => `- ${s}`).join('\n')}\n`;
        }
      }
      return text(out);
    },
  );

  server.registerTool(
    'validate_model',
    {
      title: 'Check a model for problems',
      description:
        'Report well-formedness problems: missing reference schemes, fact types without a uniqueness constraint, unattached roles, subtype cycles, and any sample facts that contradict the constraints. Run this after changing a model.',
      inputSchema: { path: z.string().describe('Path to the .orm.json file') },
    },
    async ({ path }) => {
      const issues = validateModel(loadModel(path));
      if (!issues.length) return text('No problems found.');
      const lines = issues.map((i) => `${i.severity}: [${i.code}] ${i.message}`);
      return text(`${lines.join('\n')}\n\n${summarize(issues)}`);
    },
  );

  server.registerTool(
    'generate_schema',
    {
      title: 'Map the model to a database schema',
      description:
        'Generate SQL DDL (Rmap relational mapping) or LadybugDB Cypher DDL (property graph mapping) from a model, together with the notes explaining each mapping decision.',
      inputSchema: {
        path: z.string().describe('Path to the .orm.json file'),
        target: z.enum(['relational', 'graph']),
        dialect: z.enum(['postgres', 'sqlserver', 'mysql', 'sqlite', 'ansi']).optional(),
      },
    },
    async ({ path, target, dialect }) => {
      const model = loadModel(path);
      if (target === 'graph') {
        const schema = mapToGraph(model);
        return text(`${generateGraphDdl(schema)}\n\n-- Notes\n${schema.notes.map((n) => `-- ${n}`).join('\n')}`);
      }
      const schema = mapToRelational(model);
      return text(
        `${generateDdl(schema, { dialect: (dialect ?? 'postgres') as SqlDialect })}\n-- Notes\n${schema.notes.map((n) => `-- ${n}`).join('\n')}`,
      );
    },
  );

  server.registerTool(
    'diff_models',
    {
      title: 'Compare two versions of a model',
      description:
        'Report what changed between two models as sentences rather than as a JSON diff — what the model now says that it did not say before. Use this to explain a change in a review.',
      inputSchema: {
        before: z.string().describe('Path to the earlier .orm.json'),
        after: z.string().describe('Path to the later .orm.json'),
      },
    },
    async ({ before, after }) => text(formatDiffAsText(diffModels(loadModel(before), loadModel(after)))),
  );

  server.registerTool(
    'detect_drift',
    {
      title: 'Compare the model with a database schema',
      description:
        'Compare the relational schema a model maps to against existing SQL (a dump or a migration) and report where they disagree, with the statements that would reconcile them.',
      inputSchema: {
        path: z.string().describe('Path to the .orm.json file'),
        sqlPath: z.string().describe('Path to a .sql file containing CREATE TABLE statements'),
        ignoreExtraTables: z.boolean().optional(),
      },
    },
    async ({ path, sqlPath, ignoreExtraTables }) =>
      text(
        formatDriftAsMarkdown(
          detectDrift(loadModel(path), readFileSync(resolve(sqlPath), 'utf8'), { ignoreExtraTables }),
        ),
      ),
  );

  server.registerTool(
    'read_population',
    {
      title: 'Read the sample facts',
      description:
        'The example tuples recorded against each fact type, read back through the reading as sentences. These are what a model is verified against.',
      inputSchema: { path: z.string().describe('Path to the .orm.json file') },
    },
    async ({ path }) => {
      const model = loadModel(path);
      const sections = verbalizeAllPopulations(model);
      if (!sections.length) return text('This model has no sample population.');
      return text(
        sections
          .map((s) => `## ${primaryReading(s.factType)?.text ?? s.factType.id}\n${s.sentences.map((x) => `- ${x}`).join('\n')}`)
          .join('\n\n'),
      );
    },
  );

  server.registerTool(
    'apply_model',
    {
      title: 'Write a model back',
      description:
        'Replace a .orm.json file with a new model document. The model is validated first and the write is refused when it has blocking errors, so a broken model cannot be saved. Read the model, change it, then apply it.',
      inputSchema: {
        path: z.string().describe('Path to write'),
        model: z.string().describe('The complete .orm.json document as JSON text'),
        allowErrors: z.boolean().optional().describe('Write even when validation reports errors'),
      },
    },
    async ({ path, model: document, allowErrors }) => {
      let model: OrmModel;
      try {
        model = parseModel(document);
      } catch (error) {
        return text(`Refused: the document is not a valid model. ${(error as Error).message}`);
      }
      const issues = validateModel(model);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length && !allowErrors) {
        return text(
          `Refused: the model has ${errors.length} error(s).\n${errors.map((e) => `- [${e.code}] ${e.message}`).join('\n')}\n\nFix them, or set allowErrors to write anyway.`,
        );
      }
      writeFileSync(resolve(path), serializeModel(model), 'utf8');
      return text(`Wrote ${path}. ${summarize(issues)}`);
    },
  );

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

/* c8 ignore next 3 */
if (process.argv[1] && /factum-mcp(\.[cm]?js)?$/.test(process.argv[1])) {
  void main();
}
