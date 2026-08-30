/**
 * `factum skills` — installs the bundled skill pack into a coding agent.
 *
 * The pack is plain markdown: a `SKILL.md` per skill with its references and
 * example models beside it, and one file per slash command. Claude Code and
 * Cursor both read that layout, so nothing is converted on the way in; the only
 * thing that differs between them is which directory to write to.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** The subset of the parsed command line this module needs. */
export interface SkillArgs {
  positional: string[];
  flags: Map<string, string | true>;
}

export interface SkillTarget {
  id: string;
  label: string;
  /** The agent's configuration directory, under `$HOME` or the project root. */
  root: string;
  /** What to tell the user once the files are in place. */
  note: string;
}

/**
 * Both agents read `<root>/skills/<name>/SKILL.md` and `<root>/commands/<name>.md`.
 *
 * Cursor's own built-in `create-skill` skill documents `~/.cursor/skills` and
 * `.cursor/skills`, and reserves `~/.cursor/skills-cursor` for skills it manages
 * itself — which is why nothing here writes there.
 */
export const SKILL_TARGETS: SkillTarget[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    root: '.claude',
    note: 'Commands are /orm-model, /orm-review and so on; the skills load themselves when a task mentions ORM, FORML or agent memory.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    root: '.cursor',
    note: 'Restart Cursor, or reload the window, before the new skills are offered.',
  },
];

/** Where the copied files go, and what they are called in the output. */
interface Plan {
  label: string;
  root: string;
  entries: { from: string; to: string; name: string; kind: 'skill' | 'command' }[];
}

/**
 * Finds the pack. It sits at the package root beside `bin/`, so the CLI bundle
 * looks next to itself first; a checkout running from source walks up instead.
 */
export function findSkillPack(): string | undefined {
  const candidates: string[] = [];
  const fromEnv = process.env.FACTUM_SKILLS_DIR;
  if (fromEnv) candidates.push(fromEnv);
  const entry = process.argv[1];
  if (entry) candidates.push(join(dirname(entry), '..', 'agent-skills'));
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    candidates.push(join(dir, 'agent-skills'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return candidates.find((path) => existsSync(join(path, 'skills')));
}

function listDir(path: string): string[] {
  return existsSync(path) ? readdirSync(path).filter((name) => !name.startsWith('.')).sort() : [];
}

function planFor(pack: string, target: SkillTarget, root: string): Plan {
  const entries: Plan['entries'] = [];
  for (const name of listDir(join(pack, 'skills'))) {
    const from = join(pack, 'skills', name);
    if (!statSync(from).isDirectory()) continue;
    entries.push({ from, to: join(root, 'skills', name), name, kind: 'skill' });
  }
  for (const name of listDir(join(pack, 'commands'))) {
    if (!name.endsWith('.md')) continue;
    entries.push({
      from: join(pack, 'commands', name),
      to: join(root, 'commands', name),
      name: name.replace(/\.md$/, ''),
      kind: 'command',
    });
  }
  return { label: target.label, root, entries };
}

/**
 * A blocking prompt. `run` is synchronous so the whole command line stays
 * testable as a function call; reading the descriptor directly keeps it that way.
 */
function ask(question: string): string {
  process.stdout.write(question);
  const buffer = Buffer.alloc(256);
  try {
    const read = readSync(0, buffer, 0, buffer.length, null);
    return buffer.subarray(0, read).toString('utf8').trim();
  } catch {
    return '';
  }
}

/** The target and scope, from flags where they were given and a prompt where not. */
function chooseDestination(args: SkillArgs): { target: SkillTarget; root: string } | string {
  const dir = args.flags.get('dir');
  const wanted = args.flags.get('target');
  const global = args.flags.has('global');
  const local = args.flags.has('local');
  if (global && local) return 'Choose one of --global or --local, not both.';

  let target = SKILL_TARGETS[0];
  if (typeof wanted === 'string') {
    const found = SKILL_TARGETS.find((t) => t.id === wanted);
    if (!found) {
      return `Unknown target "${wanted}". Known targets: ${SKILL_TARGETS.map((t) => t.id).join(', ')}.`;
    }
    target = found;
  }

  // `--dir` names the configuration directory itself, so it settles both.
  if (typeof dir === 'string') return { target, root: resolve(dir) };

  if (typeof wanted === 'string' || global || local) {
    const root = local ? join(process.cwd(), target.root) : join(homedir(), target.root);
    return { target, root };
  }

  if (!process.stdin.isTTY) {
    return 'Nothing to install into. Pass --target claude|cursor with --global or --local, or --dir <path>.';
  }

  const choices: { target: SkillTarget; root: string; where: string }[] = [];
  for (const t of SKILL_TARGETS) {
    choices.push({ target: t, root: join(homedir(), t.root), where: `~/${t.root}` });
    choices.push({ target: t, root: join(process.cwd(), t.root), where: `./${t.root}` });
  }
  process.stdout.write('\nWhere should the Factum skills go?\n\n');
  choices.forEach((choice, index) => {
    const scope = choice.where.startsWith('~') ? 'all your projects' : 'this project only';
    process.stdout.write(
      `  ${index + 1}) ${choice.target.label.padEnd(12)} ${choice.where.padEnd(10)} ${scope}\n`,
    );
  });
  const answer = ask(`\nChoose 1-${choices.length}, or anything else to cancel: `);
  const picked = choices[Number(answer) - 1];
  if (!picked) return 'Nothing was installed.';
  return { target: picked.target, root: picked.root };
}

export function commandSkills(args: SkillArgs): number {
  const sub = args.positional[0] ?? 'install';
  const pack = findSkillPack();
  if (!pack) {
    process.stderr.write('error: the skill pack is missing from this installation.\n');
    return 2;
  }

  if (sub === 'list') {
    const skills = listDir(join(pack, 'skills'));
    const commands = listDir(join(pack, 'commands')).map((n) => n.replace(/\.md$/, ''));
    process.stdout.write(`${skills.length} skill(s):\n`);
    for (const name of skills) process.stdout.write(`  ${name}\n`);
    process.stdout.write(`\n${commands.length} command(s):\n`);
    for (const name of commands) process.stdout.write(`  /${name}\n`);
    return 0;
  }

  if (sub !== 'install') {
    process.stderr.write(`Unknown skills command "${sub}". Use "list" or "install".\n`);
    return 1;
  }

  const destination = chooseDestination(args);
  if (typeof destination === 'string') {
    process.stderr.write(`${destination}\n`);
    return 1;
  }

  const plan = planFor(pack, destination.target, destination.root);
  const force = args.flags.has('force');
  const dryRun = args.flags.has('dry-run');
  const written: string[] = [];
  const skipped: string[] = [];

  for (const entry of plan.entries) {
    if (existsSync(entry.to) && !force) {
      skipped.push(entry.kind === 'command' ? `/${entry.name}` : entry.name);
      continue;
    }
    if (!dryRun) {
      mkdirSync(dirname(entry.to), { recursive: true });
      cpSync(entry.from, entry.to, { recursive: true });
    }
    written.push(entry.kind === 'command' ? `/${entry.name}` : entry.name);
  }

  const verb = dryRun ? 'Would install' : 'Installed';
  process.stdout.write(`${verb} ${written.length} of ${plan.entries.length} into ${plan.root}\n`);
  for (const name of written) process.stdout.write(`  + ${name}\n`);
  if (skipped.length) {
    process.stdout.write(`\n${skipped.length} already there, left alone (--force to replace):\n`);
    for (const name of skipped) process.stdout.write(`  = ${name}\n`);
  }
  if (written.length && !dryRun) process.stdout.write(`\n${destination.target.note}\n`);
  return 0;
}
