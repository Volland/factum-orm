import * as vscode from 'vscode';
import { ModelParseError, parseModel, serializeModel } from '../model/model.js';
import { OrmModel } from '../model/types.js';
import { HostMessage, WebviewMessage, WebviewSettings } from '../protocol.js';
import { OrmDiagnostics } from './diagnostics.js';

export const ORM_VIEW_TYPE = 'factum.diagram';

interface Session {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  /** Text this provider last wrote, so echoes are not pushed back to the sender. */
  lastWrittenText?: string;
}

/**
 * Custom text editor backing `.orm.json`. Every diagram edit is written to the
 * text document, so VS Code's own dirty state, undo stack and file watching all
 * work without extra bookkeeping.
 */
export class OrmEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly sessions = new Set<Session>();
  private active: Session | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly diagnostics: OrmDiagnostics,
  ) {}

  static register(context: vscode.ExtensionContext, diagnostics: OrmDiagnostics): OrmEditorProvider {
    const provider = new OrmEditorProvider(context, diagnostics);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(ORM_VIEW_TYPE, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }),
    );
    return provider;
  }

  /** The document shown in the focused ORM diagram, if any. */
  get activeDocument(): vscode.TextDocument | undefined {
    return this.active?.document;
  }

  sendToActive(message: HostMessage): boolean {
    if (!this.active) return false;
    void this.active.panel.webview.postMessage(message);
    return true;
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const session: Session = { panel, document };
    this.sessions.add(session);
    this.setActive(session, panel.active);

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out'), vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    panel.webview.html = this.buildHtml(panel.webview);

    const post = (message: HostMessage): void => {
      void panel.webview.postMessage(message);
    };

    const pushModel = (initial: boolean): void => {
      const issues = this.diagnostics.refresh(document);
      let model: OrmModel;
      try {
        model = parseModel(document.getText());
      } catch (error) {
        post({
          type: 'parseError',
          message: error instanceof ModelParseError ? error.message : String(error),
        });
        return;
      }
      if (initial) {
        post({
          type: 'init',
          model,
          issues,
          settings: readSettings(),
          // Read-only file systems (git:, vscode-vfs:, …) open as a viewer.
          editable: vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) !== false,
        });
      } else {
        post({ type: 'update', model, issues });
      }
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      // Skip the echo of an edit this webview just made.
      if (session.lastWrittenText !== undefined && event.document.getText() === session.lastWrittenText) {
        session.lastWrittenText = undefined;
        this.diagnostics.refresh(document);
        return;
      }
      pushModel(false);
    });

    const configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('orm')) return;
      post({ type: 'settings', settings: readSettings() });
      pushModel(false);
    });

    const viewStateSubscription = panel.onDidChangeViewState(() => {
      this.setActive(session, panel.active);
    });

    panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(session, message, pushModel);
    });

    panel.onDidDispose(() => {
      changeSubscription.dispose();
      configSubscription.dispose();
      viewStateSubscription.dispose();
      this.sessions.delete(session);
      if (this.active === session) {
        this.active = [...this.sessions].find((other) => other.panel.active);
        void vscode.commands.executeCommand('setContext', 'factum.activeDiagram', !!this.active);
      }
    });

    pushModel(true);
  }

  private setActive(session: Session, isActive: boolean): void {
    if (isActive) this.active = session;
    else if (this.active === session) this.active = undefined;
    void vscode.commands.executeCommand('setContext', 'factum.activeDiagram', !!this.active);
  }

  private async handleMessage(
    session: Session,
    message: WebviewMessage,
    pushModel: (initial: boolean) => void,
  ): Promise<void> {
    switch (message.type) {
      case 'ready':
        pushModel(true);
        break;
      case 'edit':
        await this.writeModel(session, message.model);
        break;
      case 'notify':
        if (message.level === 'error') void vscode.window.showErrorMessage(message.message);
        else if (message.level === 'warning') void vscode.window.showWarningMessage(message.message);
        else void vscode.window.setStatusBarMessage(message.message, 4000);
        break;
      case 'openJson':
        await vscode.commands.executeCommand('vscode.openWith', session.document.uri, 'default');
        break;
      case 'undo':
        await vscode.commands.executeCommand('undo');
        break;
      case 'redo':
        await vscode.commands.executeCommand('redo');
        break;
      case 'export':
        await this.saveExport(session, message.format, message.data);
        break;
      case 'revealElement':
        break;
    }
  }

  private async writeModel(session: Session, model: OrmModel): Promise<void> {
    const text = serializeModel(model);
    if (text === session.document.getText()) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      session.document.uri,
      new vscode.Range(0, 0, session.document.lineCount, 0),
      text,
    );
    session.lastWrittenText = text;
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      session.lastWrittenText = undefined;
      void vscode.window.showErrorMessage('The ORM model could not be saved to the document.');
      return;
    }
    this.diagnostics.refresh(session.document);
  }

  private async saveExport(session: Session, format: 'svg' | 'png', data: string): Promise<void> {
    const base = session.document.uri.path.replace(/\.orm\.json$/i, '').replace(/\.json$/i, '');
    const target = await vscode.window.showSaveDialog({
      defaultUri: session.document.uri.with({ path: `${base}.${format}` }),
      filters: format === 'svg' ? { 'SVG image': ['svg'] } : { 'PNG image': ['png'] },
    });
    if (!target) return;
    const bytes = format === 'svg' ? Buffer.from(data, 'utf8') : Buffer.from(data, 'base64');
    await vscode.workspace.fs.writeFile(target, bytes);
    const open = await vscode.window.showInformationMessage(
      `Diagram exported to ${vscode.workspace.asRelativePath(target)}.`,
      'Open',
    );
    if (open) await vscode.commands.executeCommand('vscode.open', target);
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'));
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>ORM Diagram</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export function readSettings(): WebviewSettings {
  const config = vscode.workspace.getConfiguration('orm');
  return {
    snapToGrid: config.get<boolean>('diagram.snapToGrid', true),
    gridSize: config.get<number>('diagram.gridSize', 10),
    showGrid: config.get<boolean>('diagram.showGrid', true),
    verbalizationMode: config.get<'forml' | 'plain'>('verbalization.mode', 'forml'),
    ddlDialect: config.get<WebviewSettings['ddlDialect']>('ddl.dialect', 'postgres'),
    graphSubtypeStrategy: config.get<WebviewSettings['graphSubtypeStrategy']>(
      'graph.subtypeStrategy',
      'nodeTable',
    ),
  };
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
