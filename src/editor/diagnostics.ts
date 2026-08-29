import * as vscode from 'vscode';
import { OrmModel } from '../model/types.js';
import { ModelParseError, parseModel } from '../model/model.js';
import { Issue, validateModel } from '../core/validate.js';

const SEVERITY: Record<Issue['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

/** Owns the Problems-panel entries for every open `.orm.json` document. */
export class OrmDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('orm');

  refresh(document: vscode.TextDocument): Issue[] {
    if (!vscode.workspace.getConfiguration('orm').get<boolean>('validation.enabled', true)) {
      this.collection.delete(document.uri);
      return [];
    }
    let model: OrmModel;
    try {
      model = parseModel(document.getText());
    } catch (error) {
      const message = error instanceof ModelParseError ? error.message : String(error);
      this.collection.set(document.uri, [
        new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), message, vscode.DiagnosticSeverity.Error),
      ]);
      return [];
    }

    const issues = validateModel(model);
    this.collection.set(
      document.uri,
      issues.map((issue) => {
        const diagnostic = new vscode.Diagnostic(
          locate(document, issue.elementId),
          issue.message,
          SEVERITY[issue.severity],
        );
        diagnostic.source = 'ORM';
        diagnostic.code = issue.code;
        return diagnostic;
      }),
    );
    return issues;
  }

  clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  dispose(): void {
    this.collection.dispose();
  }
}

/** Finds `"id": "<elementId>"` so a diagnostic points at the right JSON line. */
function locate(document: vscode.TextDocument, elementId: string): vscode.Range {
  const text = document.getText();
  const needle = `"id": ${JSON.stringify(elementId)}`;
  let offset = text.indexOf(needle);
  if (offset < 0) offset = text.indexOf(JSON.stringify(elementId));
  if (offset < 0) return new vscode.Range(0, 0, 0, 1);
  const start = document.positionAt(offset);
  const end = document.positionAt(offset + needle.length);
  return new vscode.Range(start, end);
}
