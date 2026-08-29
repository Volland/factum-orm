/**
 * Compares two versions of a model and reports the change as sentences.
 *
 * A JSON diff of a `.orm.json` file is readable, but it is still a diff of
 * arrays and ids. What a reviewer needs to see is what the model now *says* —
 * so the comparison is made over the verbalization, keyed by element id, and a
 * renamed or re-constrained element shows up as one changed sentence rather
 * than an addition and a deletion.
 */

import { OrmModel } from '../model/types.js';
import { populationOf } from '../model/model.js';
import { verbalizeModel, VerbalizeOptions } from './verbalize.js';

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface SentenceChange {
  kind: ChangeKind;
  /** The element the sentence describes. */
  targetId: string;
  category: 'objectType' | 'factType' | 'subtype' | 'constraint';
  /** Present for `removed` and `changed`. */
  before?: string;
  /** Present for `added` and `changed`. */
  after?: string;
}

export interface ModelDiff {
  changes: SentenceChange[];
  /** Counts that do not have a sentence of their own. */
  counts: {
    objectTypes: [number, number];
    factTypes: [number, number];
    constraints: [number, number];
    population: [number, number];
  };
}

/** A stable key for one verbalized line: its element plus its position under it. */
function sentences(model: OrmModel, options: VerbalizeOptions): Map<string, SentenceChange> {
  const out = new Map<string, SentenceChange>();
  for (const group of verbalizeModel(model, options)) {
    group.lines.forEach((line, position) => {
      const key = `${line.kind}:${line.targetId}:${position}`;
      out.set(key, {
        kind: 'added',
        targetId: line.targetId,
        category: line.kind,
        after: line.text,
      });
    });
  }
  return out;
}

export function diffModels(before: OrmModel, after: OrmModel, options: VerbalizeOptions = {}): ModelDiff {
  const a = sentences(before, options);
  const b = sentences(after, options);
  const changes: SentenceChange[] = [];

  for (const [key, entry] of b) {
    const previous = a.get(key);
    if (!previous) {
      changes.push(entry);
    } else if (previous.after !== entry.after) {
      changes.push({ ...entry, kind: 'changed', before: previous.after, after: entry.after });
    }
  }
  for (const [key, entry] of a) {
    if (b.has(key)) continue;
    changes.push({ ...entry, kind: 'removed', before: entry.after, after: undefined });
  }

  // Removals read better before the additions that replaced them.
  const order: Record<ChangeKind, number> = { changed: 0, added: 1, removed: 2 };
  changes.sort((x, y) => order[x.kind] - order[y.kind] || (x.after ?? x.before ?? '').localeCompare(y.after ?? y.before ?? ''));

  const population = (m: OrmModel): number =>
    m.factTypes.reduce((total, ft) => total + populationOf(ft).length, 0);

  return {
    changes,
    counts: {
      objectTypes: [before.objectTypes.length, after.objectTypes.length],
      factTypes: [before.factTypes.length, after.factTypes.length],
      constraints: [before.constraints.length, after.constraints.length],
      population: [population(before), population(after)],
    },
  };
}

/** True when nothing the model says has changed. */
export function isUnchanged(diff: ModelDiff): boolean {
  return diff.changes.length === 0;
}

/**
 * The diff as Markdown, for a pull request comment. Sentences are rendered in a
 * diff block so the `+` and `-` colour the way a reviewer expects.
 */
export function formatDiffAsMarkdown(diff: ModelDiff, title = 'Conceptual schema changes'): string {
  if (isUnchanged(diff)) {
    return `### ${title}\n\nThe model says exactly what it said before.\n`;
  }

  const lines: string[] = [`### ${title}`, ''];
  const changed = diff.changes.filter((c) => c.kind === 'changed');
  const added = diff.changes.filter((c) => c.kind === 'added');
  const removed = diff.changes.filter((c) => c.kind === 'removed');

  const summary = [
    changed.length ? `${changed.length} changed` : '',
    added.length ? `${added.length} added` : '',
    removed.length ? `${removed.length} removed` : '',
  ].filter(Boolean);
  lines.push(`${summary.join(', ')}.`, '');

  lines.push('```diff');
  for (const change of changed) {
    lines.push(`- ${change.before}`, `+ ${change.after}`);
  }
  for (const change of added) lines.push(`+ ${change.after}`);
  for (const change of removed) lines.push(`- ${change.before}`);
  lines.push('```', '');

  const [ob, oa] = diff.counts.objectTypes;
  const [fb, fa] = diff.counts.factTypes;
  const [cb, ca] = diff.counts.constraints;
  const [pb, pa] = diff.counts.population;
  lines.push(
    '| | before | after |',
    '| --- | ---: | ---: |',
    `| Object types | ${ob} | ${oa} |`,
    `| Fact types | ${fb} | ${fa} |`,
    `| Constraints | ${cb} | ${ca} |`,
    `| Sample facts | ${pb} | ${pa} |`,
    '',
  );
  return lines.join('\n');
}

/** The diff as plain text, for a terminal. */
export function formatDiffAsText(diff: ModelDiff): string {
  if (isUnchanged(diff)) return 'No change: the model says exactly what it said before.\n';
  const lines: string[] = [];
  for (const change of diff.changes) {
    if (change.kind === 'changed') {
      lines.push(`- ${change.before}`, `+ ${change.after}`);
    } else if (change.kind === 'added') {
      lines.push(`+ ${change.after}`);
    } else {
      lines.push(`- ${change.before}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
