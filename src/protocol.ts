import { OrmModel } from './model/types.js';
import { Issue } from './core/validate.js';

/** Settings the webview needs; mirrors the `orm.*` configuration section. */
export interface WebviewSettings {
  snapToGrid: boolean;
  gridSize: number;
  showGrid: boolean;
  verbalizationMode: 'forml' | 'plain';
  ddlDialect: 'postgres' | 'sqlserver' | 'mysql' | 'sqlite' | 'ansi';
  graphSubtypeStrategy: 'nodeTable' | 'absorb';
}

export type HostMessage =
  | { type: 'init'; model: OrmModel; issues: Issue[]; settings: WebviewSettings; editable: boolean }
  | { type: 'update'; model: OrmModel; issues: Issue[] }
  | { type: 'settings'; settings: WebviewSettings }
  | { type: 'command'; name: 'autoLayout' | 'exportSvg' | 'exportPng' | 'zoomToFit' }
  | { type: 'parseError'; message: string };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'edit'; model: OrmModel; label: string }
  | { type: 'export'; format: 'svg' | 'png'; data: string }
  | { type: 'notify'; level: 'info' | 'warning' | 'error'; message: string }
  | { type: 'openJson' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'revealElement'; elementId: string };
