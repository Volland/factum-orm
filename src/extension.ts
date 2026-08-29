import * as vscode from 'vscode';
import { OrmEditorProvider, ORM_VIEW_TYPE } from './editor/ormEditorProvider.js';
import { OrmDiagnostics } from './editor/diagnostics.js';
import { ModelParseError, parseModel, serializeModel } from './model/model.js';
import { sampleModel } from './model/sample.js';
import { OrmModel } from './model/types.js';
import { verbalizeModelAsText } from './core/verbalize.js';
import { mapToRelational } from './core/rmap.js';
import { generateDdl, SqlDialect } from './core/ddl.js';
import { GraphMapOptions, mapToGraph } from './core/lpg.js';
import { generateGraphDdl } from './core/graphDdl.js';
import { summarize, validateModel } from './core/validate.js';
import { importNormaFile } from './io/normaImport.js';
import { exportNormaFile } from './io/normaExport.js';
import { exportFbmFile, importFbmFile } from './io/fbm.js';
import { exportOssieFile, importOssieFile } from './io/ossie.js';
import { exportUmsFile, importUmsFile } from './io/ums.js';
import { detectFormat, ExportResult, FORMAT_INFO, ImportResult, InteropFormat } from './io/interop.js';

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = new OrmDiagnostics();
  const provider = OrmEditorProvider.register(context, diagnostics);
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (isOrmDocument(document)) diagnostics.refresh(document);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isOrmDocument(event.document)) diagnostics.refresh(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (isOrmDocument(document)) diagnostics.clear(document.uri);
    }),
  );
  for (const document of vscode.workspace.textDocuments) {
    if (isOrmDocument(document)) diagnostics.refresh(document);
  }

  const register = (name: string, handler: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  };

  register('orm.newModel', () => createNewModel());
  register('orm.importNorma', (resource?: vscode.Uri) => importModel(resource, 'norma'));
  register('orm.importModel', (resource?: vscode.Uri) => importModel(resource));
  register('orm.exportModel', () => exportModel(provider));
  register('orm.generateDdl', () => generateDdlCommand(provider));
  register('orm.showRelationalSchema', () => showRelationalSchema(provider));
  register('orm.generateGraphSchema', () => generateGraphSchemaCommand(provider));
  register('orm.showVerbalization', () => showVerbalization(provider));
  register('orm.exportSvg', () => sendCommand(provider, 'exportSvg'));
  register('orm.exportPng', () => sendCommand(provider, 'exportPng'));
  register('orm.autoLayout', () => sendCommand(provider, 'autoLayout'));
  register('orm.openAsJson', () => openAsJson(provider));
}

export function deactivate(): void {
  // Diagnostics and the editor provider are disposed through context.subscriptions.
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

async function createNewModel(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const suggested = folder
    ? vscode.Uri.joinPath(folder.uri, 'model.orm.json')
    : vscode.Uri.file('model.orm.json');
  const target = await vscode.window.showSaveDialog({
    defaultUri: suggested,
    filters: { 'ORM model': ['json'] },
    saveLabel: 'Create ORM model',
  });
  if (!target) return;

  const name = target.path.split('/').pop()?.replace(/\.orm\.json$|\.json$/i, '') ?? 'New Model';
  const text = serializeModel(sampleModel(name));
  await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
  await vscode.commands.executeCommand('vscode.openWith', target, ORM_VIEW_TYPE);
}

/** Reads one interchange document into a `.orm.json` beside it. */
async function importModel(resource?: vscode.Uri, forced?: InteropFormat): Promise<void> {
  let source = resource;
  if (!source) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Import',
      filters: forced
        ? { [FORMAT_INFO[forced].label]: [FORMAT_INFO[forced].extension], 'All files': ['*'] }
        : {
            'Fact-based model': ['orm', 'fbm', 'yaml', 'yml'],
            'NORMA ORM 2 model': ['orm'],
            'FBM Exchange MetaModel': ['fbm'],
            'Ossie or UMS (YAML)': ['yaml', 'yml'],
            'All files': ['*'],
          },
    });
    source = picked?.[0];
  }
  if (!source) return;

  try {
    const bytes = await vscode.workspace.fs.readFile(source);
    const text = Buffer.from(bytes).toString('utf8');
    const format = forced ?? detectFormat(source.path, text);
    if (!format) {
      void vscode.window.showErrorMessage(
        `Could not tell what format "${basename(source)}" is. Supported: NORMA .orm, FBM .fbm, and Apache Ossie or UMS YAML.`,
      );
      return;
    }

    const readers: Record<InteropFormat, (input: string) => ImportResult> = {
      norma: importNormaFile,
      fbm: importFbmFile,
      ossie: importOssieFile,
      ums: importUmsFile,
    };
    const { model, warnings } = readers[format](text);

    const target = source.with({
      path: source.path.replace(/\.(orm|fbm|ya?ml)$/i, '') + '.orm.json',
    });
    await vscode.workspace.fs.writeFile(target, Buffer.from(serializeModel(model), 'utf8'));
    await vscode.commands.executeCommand('vscode.openWith', target, ORM_VIEW_TYPE);

    const issues = validateModel(model);
    const summary = `Imported ${model.objectTypes.length} object types and ${model.factTypes.length} fact types from ${FORMAT_INFO[format].label}. ${summarize(issues)}`;
    await reportWarnings(summary, warnings, 'Import');
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not import "${basename(source)}": ${(error as Error).message}`);
  }
}

/** Writes the focused model out in one of the interchange formats. */
async function exportModel(provider: OrmEditorProvider): Promise<void> {
  const model = await resolveModel(provider);
  if (!model) return;

  const choice = await vscode.window.showQuickPick(
    [
      {
        label: 'FBM Exchange MetaModel',
        description: '.fbm',
        detail: 'Conceptual XML for the fact-based modelling community. Closest to a lossless round trip.',
        format: 'fbm' as const,
      },
      {
        label: 'Apache Ossie ontology',
        description: '.yaml',
        detail: 'Concepts, relationships and verbalizations. Objectification and the diagram are dropped.',
        format: 'ossie' as const,
      },
      {
        label: 'NORMA ORM 2',
        description: '.orm',
        detail: 'XML for NORMA and Visual Studio. Diagram geometry is not written.',
        format: 'norma' as const,
      },
      {
        label: 'Unified Modelling Schema',
        description: '.yaml',
        detail: 'Logical types with properties and relationships, via the property graph mapping.',
        format: 'ums' as const,
      },
    ],
    { placeHolder: 'Export the model as', matchOnDetail: true },
  );
  if (!choice) return;

  const writers: Record<InteropFormat, (input: OrmModel) => ExportResult> = {
    norma: exportNormaFile,
    fbm: exportFbmFile,
    ossie: exportOssieFile,
    ums: exportUmsFile,
  };

  let result: ExportResult;
  try {
    result = writers[choice.format](model);
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not export the model: ${(error as Error).message}`);
    return;
  }

  const info = FORMAT_INFO[choice.format];
  const folder = vscode.workspace.workspaceFolders?.[0];
  const fileName = `${model.name.replace(/[^A-Za-z0-9_-]+/g, '') || 'model'}.${info.extension}`;
  const target = await vscode.window.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder.uri, fileName) : vscode.Uri.file(fileName),
    filters: { [info.label]: [info.extension] },
    saveLabel: `Export as ${info.label}`,
  });
  if (!target) return;

  await vscode.workspace.fs.writeFile(target, Buffer.from(result.text, 'utf8'));
  const document = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(document, { preview: false });
  await reportWarnings(`Exported as ${info.label}.`, result.warnings, 'Export');
}

/** Shows a conversion summary, with the warnings behind a button. */
async function reportWarnings(summary: string, warnings: string[], title: string): Promise<void> {
  if (!warnings.length) {
    void vscode.window.showInformationMessage(summary);
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    `${summary} ${warnings.length} warning(s).`,
    'Show warnings',
  );
  if (!choice) return;
  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: `# ${title} warnings\n\n${warnings.map((w) => `- ${w}`).join('\n')}\n`,
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

function basename(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? uri.path;
}

async function generateDdlCommand(provider: OrmEditorProvider): Promise<void> {
  const model = await resolveModel(provider);
  if (!model) return;
  const issues = validateModel(model);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    const choice = await vscode.window.showWarningMessage(
      `The model has ${errors.length} error(s). Generated SQL may be incomplete.`,
      'Generate anyway',
      'Show problems',
    );
    if (choice === 'Show problems') {
      await vscode.commands.executeCommand('workbench.actions.view.problems');
      return;
    }
    if (choice !== 'Generate anyway') return;
  }

  const dialect = vscode.workspace.getConfiguration('orm').get<SqlDialect>('ddl.dialect', 'postgres');
  const quoteIdentifiers = vscode.workspace.getConfiguration('orm').get<boolean>('ddl.quoteIdentifiers', false);
  const sql = generateDdl(mapToRelational(model), { dialect, quoteIdentifiers, includeDrops: false });
  const document = await vscode.workspace.openTextDocument({ language: 'sql', content: sql });
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

/**
 * Maps the model to a labeled property graph and opens the LadybugDB DDL.
 * The relational and graph mappings answer different questions, so this runs
 * alongside `orm.generateDdl` rather than replacing it.
 */
async function generateGraphSchemaCommand(provider: OrmEditorProvider): Promise<void> {
  const model = await resolveModel(provider);
  if (!model) return;
  const issues = validateModel(model);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    const choice = await vscode.window.showWarningMessage(
      `The model has ${errors.length} error(s). The generated graph schema may be incomplete.`,
      'Generate anyway',
      'Show problems',
    );
    if (choice === 'Show problems') {
      await vscode.commands.executeCommand('workbench.actions.view.problems');
      return;
    }
    if (choice !== 'Generate anyway') return;
  }

  const config = vscode.workspace.getConfiguration('orm');
  const subtypeStrategy = config.get<GraphMapOptions['subtypeStrategy']>('graph.subtypeStrategy', 'nodeTable');
  const ifNotExists = config.get<boolean>('graph.ifNotExists', false);
  const cypher = generateGraphDdl(mapToGraph(model, { subtypeStrategy }), { ifNotExists });
  await openGenerated(cypher, 'cypher');
}

/** Opens generated text, falling back to plain text when the language is not installed. */
async function openGenerated(content: string, language: string): Promise<void> {
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument({ language, content });
  } catch {
    document = await vscode.workspace.openTextDocument({ content });
  }
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

async function showRelationalSchema(provider: OrmEditorProvider): Promise<void> {
  const model = await resolveModel(provider);
  if (!model) return;
  const schema = mapToRelational(model);
  const lines: string[] = [`# ${schema.name} — relational mapping`, ''];
  for (const table of schema.tables) {
    lines.push(`## ${table.name}`, '');
    if (table.comment) lines.push(`_${table.comment}_`, '');
    lines.push('| Column | Type | Null | Key |', '| --- | --- | --- | --- |');
    for (const column of table.columns) {
      const keys: string[] = [];
      if (table.primaryKey.includes(column.name)) keys.push('PK');
      const fk = table.foreignKeys.find((key) => key.columns.includes(column.name));
      if (fk) keys.push(`FK → ${fk.refTable}`);
      lines.push(`| ${column.name} | ${column.dataType} | ${column.nullable ? 'yes' : 'no'} | ${keys.join(', ')} |`);
    }
    lines.push('');
  }
  if (schema.notes.length) {
    lines.push('## Mapping notes', '', ...schema.notes.map((note) => `- ${note}`), '');
  }
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: lines.join('\n') });
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}

async function showVerbalization(provider: OrmEditorProvider): Promise<void> {
  const model = await resolveModel(provider);
  if (!model) return;
  const mode = vscode.workspace.getConfiguration('orm').get<'forml' | 'plain'>('verbalization.mode', 'forml');
  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: verbalizeModelAsText(model, { mode }),
  });
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}

async function openAsJson(provider: OrmEditorProvider): Promise<void> {
  const document = provider.activeDocument ?? vscode.window.activeTextEditor?.document;
  if (!document) return;
  await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
}

function sendCommand(provider: OrmEditorProvider, name: 'autoLayout' | 'exportSvg' | 'exportPng'): void {
  if (!provider.sendToActive({ type: 'command', name })) {
    void vscode.window.showInformationMessage('Open an ORM diagram first.');
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function isOrmDocument(document: vscode.TextDocument): boolean {
  return document.uri.path.toLowerCase().endsWith('.orm.json');
}

/** The model behind the focused diagram, or the focused `.orm.json` editor. */
async function resolveModel(provider: OrmEditorProvider): Promise<OrmModel | undefined> {
  const document =
    provider.activeDocument ??
    (vscode.window.activeTextEditor && isOrmDocument(vscode.window.activeTextEditor.document)
      ? vscode.window.activeTextEditor.document
      : undefined);
  if (!document) {
    void vscode.window.showInformationMessage('Open an ORM model (.orm.json) first.');
    return undefined;
  }
  try {
    return parseModel(document.getText());
  } catch (error) {
    const message = error instanceof ModelParseError ? error.message : String(error);
    void vscode.window.showErrorMessage(`Could not read the ORM model: ${message}`);
    return undefined;
  }
}
