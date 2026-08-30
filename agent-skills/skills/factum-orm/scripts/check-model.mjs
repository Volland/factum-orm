#!/usr/bin/env node
/**
 * check-model.mjs - an offline ORM 2 model checker.
 *
 * Implements the validation codes documented in references/validation.md without
 * requiring the Factum CLI. Where `factum validate` is available it is the
 * authority; this is here so the skill can still check its own work.
 *
 *   node check-model.mjs <model.orm.json> [--strict] [--format text|json]
 *
 * Exit: 0 clean, 1 blocking errors (or warnings with --strict), 2 unreadable input.
 */
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith('-'));
const strict = argv.includes('--strict');
const json = argv.includes('--format') && argv[argv.indexOf('--format') + 1] === 'json';

if (files.length !== 1) {
  console.error('usage: check-model.mjs <model.orm.json> [--strict] [--format text|json]');
  process.exit(2);
}

let model;
try {
  model = JSON.parse(readFileSync(files[0], 'utf8'));
} catch (e) {
  console.error(`could not read or parse ${files[0]}: ${e.message}`);
  process.exit(2);
}

const problems = [];
const err = (code, message) => problems.push({ severity: 'error', code, message });
const warn = (code, message) => problems.push({ severity: 'warning', code, message });

const objectTypes = model.objectTypes ?? [];
const factTypes = model.factTypes ?? [];
const subtypeRelations = model.subtypeRelations ?? [];
const constraints = model.constraints ?? [];

const otById = new Map(objectTypes.map((o) => [o.id, o]));
const roleById = new Map(); // roleId -> { role, factType, index }
for (const ft of factTypes) {
  (ft.roles ?? []).forEach((role, index) => roleById.set(role.id, { role, factType: ft, index }));
}
const ftById = new Map(factTypes.map((f) => [f.id, f]));
const name = (id) => otById.get(id)?.name ?? id;
const label = (ft) =>
  ft.readings?.[0]?.text?.replace(/\{(\d+)\}/g, (_, i) => {
    const order = ft.readings[0].roleOrder ?? [];
    return name(roleById.get(order[Number(i)])?.role.objectTypeId);
  }) ?? ft.id;

/* ---------------------------------------------------------------- structural */

const seenNames = new Map();
for (const ot of objectTypes) {
  if (!ot.name) err('unnamed-object-type', `Object type "${ot.id}" has no name.`);
  else if (seenNames.has(ot.name)) err('duplicate-object-type-name', `Two object types are named "${ot.name}".`);
  else seenNames.set(ot.name, ot.id);
  if (ot.objectifiedFactTypeId && !ftById.has(ot.objectifiedFactTypeId))
    err('dangling-objectification', `"${ot.name}" objectifies fact type "${ot.objectifiedFactTypeId}", which does not exist.`);
}

const objectifiers = new Map();
for (const ot of objectTypes) {
  if (!ot.objectifiedFactTypeId) continue;
  objectifiers.set(ot.objectifiedFactTypeId, [...(objectifiers.get(ot.objectifiedFactTypeId) ?? []), ot.name]);
}
for (const [ftId, owners] of objectifiers)
  if (owners.length > 1)
    err('multiple-objectification', `Fact type "${ftById.has(ftId) ? label(ftById.get(ftId)) : ftId}" is objectified by ${owners.join(' and ')}. Keep one.`);

for (const ft of factTypes) {
  const roles = ft.roles ?? [];
  if (roles.length === 0) err('empty-fact-type', `Fact type "${ft.id}" has no roles.`);
  for (const role of roles) {
    if (role.objectTypeId == null) err('unattached-role', `Role "${role.id}" has no player.`);
    else if (!otById.has(role.objectTypeId))
      err('dangling-role-player', `Role "${role.id}" references object type "${role.objectTypeId}", which does not exist.`);
  }
  const readings = ft.readings ?? [];
  if (readings.length === 0) err('no-reading', `Fact type "${ft.id}" has no reading.`);
  for (const rd of readings) {
    const order = rd.roleOrder ?? [];
    if (order.length !== roles.length)
      err('reading-arity-mismatch', `Reading "${rd.id}" orders ${order.length} role(s); "${ft.id}" has ${roles.length}.`);
    const own = new Set(roles.map((r) => r.id));
    if (order.length === roles.length && (new Set(order).size !== order.length || order.some((id) => !own.has(id))))
      err('reading-role-order', `Reading "${rd.id}" does not name exactly the roles of "${ft.id}".`);
    for (const m of String(rd.text ?? '').matchAll(/\{(\d+)\}/g))
      if (Number(m[1]) >= order.length)
        err('reading-placeholder-range', `Reading "${rd.id}" uses {${m[1]}}, outside its role order.`);
  }
}

for (const sr of subtypeRelations) {
  for (const k of ['subtypeId', 'supertypeId'])
    if (!otById.has(sr[k]))
      err('dangling-subtype', `Subtype relation "${sr.id}" references object type "${sr[k]}", which does not exist.`);
  if (sr.subtypeId === sr.supertypeId) err('self-subtype', `"${name(sr.subtypeId)}" is its own subtype.`);
  const sub = otById.get(sr.subtypeId);
  const sup = otById.get(sr.supertypeId);
  if (sub && sup && sub.kind !== sup.kind)
    err('subtype-kind-mismatch', `"${sub.name}" (${sub.kind}) is a subtype of "${sup.name}" (${sup.kind}).`);
}

const supersOf = new Map();
for (const sr of subtypeRelations) supersOf.set(sr.subtypeId, [...(supersOf.get(sr.subtypeId) ?? []), sr.supertypeId]);
const ancestors = (id, seen = new Set()) => {
  for (const sup of supersOf.get(id) ?? [])
    if (!seen.has(sup)) {
      seen.add(sup);
      ancestors(sup, seen);
    }
  return seen;
};
for (const ot of objectTypes) if (ancestors(ot.id).has(ot.id)) err('subtype-cycle', `"${ot.name}" is in a subtype cycle.`);

const compatible = (a, b) => a === b || ancestors(a).has(b) || ancestors(b).has(a);

/* --------------------------------------------------------------- constraints */

const rolesOf = (c) => c.roles ?? [];
const factTypesOf = (ids) => new Set(ids.map((id) => roleById.get(id)?.factType?.id).filter(Boolean));

for (const c of constraints) {
  if (['uniqueness', 'mandatory', 'frequency', 'ring'].includes(c.kind) && rolesOf(c).length === 0)
    err('empty-constraint', `Constraint "${c.id}" (${c.kind}) has no roles.`);
  for (const rid of rolesOf(c))
    if (!roleById.has(rid))
      err('dangling-constraint-role', `Constraint "${c.id}" references role "${rid}", which does not exist.`);
  for (const seq of c.roleSequences ?? [])
    for (const rid of seq)
      if (!roleById.has(rid))
        err('dangling-constraint-role', `Constraint "${c.id}" references role "${rid}", which does not exist.`);

  if (c.kind === 'uniqueness' && factTypesOf(rolesOf(c)).size > 1 && rolesOf(c).length < 2)
    err('external-uniqueness-unary', `External uniqueness constraint "${c.id}" spans a single role.`);

  if (c.kind === 'mandatory' && rolesOf(c).length > 1) {
    const players = new Set(rolesOf(c).map((rid) => roleById.get(rid)?.role.objectTypeId));
    if (players.size > 1)
      err('mandatory-player-mismatch', `Disjunctive mandatory "${c.id}" spans roles played by ${[...players].map(name).join(', ')}.`);
  }

  if (c.kind === 'frequency') {
    if (typeof c.min !== 'number' || c.min < 0 || (c.max != null && c.max < c.min))
      err('bad-frequency-range', `Frequency constraint "${c.id}" has an impossible range ${c.min}..${c.max}.`);
    else if (c.min === 1 && c.max === 1)
      warn('frequency-is-uniqueness', `Frequency constraint "${c.id}" is exactly one, which is a uniqueness constraint.`);
  }

  if (c.kind === 'cardinality' && ((c.min != null && c.min < 0) || (c.min != null && c.max != null && c.max < c.min)))
    err('bad-cardinality-range', `Cardinality constraint "${c.id}" has an impossible range ${c.min}..${c.max}.`);

  if (c.kind === 'ring') {
    const types = c.types ?? [];
    if (types.length === 0) err('empty-ring', `Ring constraint "${c.id}" has no ring types.`);
    if (types.includes('symmetric') && types.includes('asymmetric'))
      err('contradictory-ring', `Ring constraint "${c.id}" is both symmetric and asymmetric.`);
    const players = rolesOf(c).map((rid) => roleById.get(rid)?.role.objectTypeId).filter(Boolean);
    if (players.length === 2 && !compatible(players[0], players[1]))
      err('ring-incompatible-roles', `Ring constraint "${c.id}" spans roles played by ${name(players[0])} and ${name(players[1])}.`);
  }

  if (['subset', 'exclusion', 'equality'].includes(c.kind)) {
    const seqs = c.roleSequences ?? [];
    if (seqs.length < 2) err('set-constraint-arity', `Set-comparison constraint "${c.id}" has fewer than two role sequences.`);
    else if (new Set(seqs.map((s) => s.length)).size > 1)
      err('set-constraint-length', `Set-comparison constraint "${c.id}" has role sequences of different lengths.`);
    else
      for (let i = 0; i < seqs[0].length; i++) {
        const players = seqs.map((s) => roleById.get(s[i])?.role.objectTypeId).filter(Boolean);
        if (players.length === seqs.length && !players.every((p) => compatible(p, players[0])))
          err('set-constraint-compatibility', `Set-comparison constraint "${c.id}" compares ${players.map(name).join(' with ')} at position ${i}.`);
      }
  }

  if (c.kind === 'value') {
    if (!c.ranges || c.ranges.length === 0) err('empty-value-constraint', `Value constraint "${c.id}" has no ranges.`);
    if (c.objectTypeId == null && c.roleId == null)
      err('untargeted-value-constraint', `Value constraint "${c.id}" targets neither an object type nor a role.`);
    if (c.objectTypeId != null && !otById.has(c.objectTypeId))
      err('dangling-value-constraint', `Value constraint "${c.id}" targets object type "${c.objectTypeId}", which does not exist.`);
    if (c.roleId != null && !roleById.has(c.roleId))
      err('dangling-value-constraint', `Value constraint "${c.id}" targets role "${c.roleId}", which does not exist.`);
  }

  if (c.kind === 'subtypeSet') {
    const ids = c.subtypeRelationIds ?? [];
    const rels = ids.map((id) => subtypeRelations.find((s) => s.id === id));
    rels.forEach((r, i) => {
      if (!r) err('dangling-subtype-set', `Subtype set "${c.id}" references subtype relation "${ids[i]}", which does not exist.`);
    });
    const supers = new Set(rels.filter(Boolean).map((r) => r.supertypeId));
    if (supers.size > 1 || (c.supertypeId != null && supers.size === 1 && !supers.has(c.supertypeId)))
      err('subtype-set-mismatch', `Subtype set "${c.id}" groups relations that do not share a supertype.`);
  }
}

/* ------------------------------------------------------------ identification */

const uniqueness = constraints.filter((c) => c.kind === 'uniqueness');
const identified = new Set();
for (const c of uniqueness) {
  if (!c.isPreferredIdentifier) continue;
  for (const rid of rolesOf(c)) {
    const entry = roleById.get(rid);
    if (!entry) continue;
    for (const other of entry.factType.roles ?? []) if (other.id !== rid && other.objectTypeId) identified.add(other.objectTypeId);
  }
}
for (const ot of objectTypes) {
  if (ot.kind === 'value') {
    if (ot.refMode) warn('value-type-ref-mode', `Value type "${ot.name}" carries a reference mode. Value types identify themselves.`);
    continue;
  }
  const inherits = [...ancestors(ot.id)].some((a) => otById.get(a)?.refMode || identified.has(a));
  if (!ot.refMode && !identified.has(ot.id) && !ot.objectifiedFactTypeId && !inherits)
    err('no-reference-scheme', `Entity type "${ot.name}" has no reference mode and no preferred identifier.`);
}
const hasPreferredPath = new Set(subtypeRelations.filter((s) => s.isPreferredIdentificationPath).map((s) => s.subtypeId));
for (const [sub, supers] of supersOf)
  if (supers.length > 1 && !hasPreferredPath.has(sub))
    warn('ambiguous-identification-path', `"${name(sub)}" has ${supers.length} identification paths. Mark one isPreferredIdentificationPath.`);

/* -------------------------------------------------------------- elementarity */

for (const ft of factTypes) {
  const arity = (ft.roles ?? []).length;
  if (arity === 0) continue;
  const own = uniqueness.filter((c) => {
    const fts = factTypesOf(rolesOf(c));
    return fts.size === 1 && fts.has(ft.id);
  });
  if (own.length === 0) {
    err('missing-uniqueness', `Fact type "${label(ft)}" has no uniqueness constraint. Add one to say how many times a fact may be repeated.`);
    continue;
  }
  for (const c of own) {
    const span = rolesOf(c).length;
    if (span < arity - 1)
      err(
        'uniqueness-too-narrow',
        `An internal uniqueness constraint on "${label(ft)}" spans ${span} of ${arity} roles. It must span at least ${arity - 1}; otherwise the fact type is not elementary and should be split.`,
      );
  }
  if (own.some((c) => rolesOf(c).length === arity) && own.some((c) => rolesOf(c).length < arity))
    warn('redundant-spanning-uniqueness', `The spanning uniqueness constraint on "${label(ft)}" is made redundant by a narrower one.`);
}

const key = (ids) => [...ids].sort().join('|');
const preferredKeys = new Set(uniqueness.filter((c) => c.isPreferredIdentifier).map((c) => key(rolesOf(c))));
for (const c of constraints)
  if (c.kind === 'mandatory' && preferredKeys.has(key(rolesOf(c))))
    warn('implied-mandatory', `Mandatory constraint "${c.id}" is already implied by a preferred identifier.`);

/* ---------------------------------------------------------------- population */

const inRange = (value, ranges) =>
  ranges.some((r) => {
    if (r.value !== undefined) return String(r.value) === String(value);
    const numeric = typeof r.min === 'number' || typeof r.max === 'number';
    const v = numeric ? Number(value) : String(value);
    if (numeric && Number.isNaN(v)) return false;
    const lo = r.min !== undefined ? (r.minInclusive === false ? v > r.min : v >= r.min) : true;
    const hi = r.max !== undefined ? (r.maxInclusive === false ? v < r.max : v <= r.max) : true;
    return lo && hi;
  });

let sampleFacts = 0;
for (const ft of factTypes) {
  const rows = ft.population ?? [];
  sampleFacts += rows.length;
  const arity = (ft.roles ?? []).length;
  rows.forEach((row, i) => {
    if ((row.values ?? []).length !== arity)
      err('population-arity', `Row ${i + 1} of "${label(ft)}" has ${(row.values ?? []).length} value(s); the fact type has ${arity} role(s).`);
  });
}

for (const c of uniqueness) {
  const fts = factTypesOf(rolesOf(c));
  if (fts.size !== 1) continue;
  const ft = ftById.get([...fts][0]);
  const rows = ft?.population ?? [];
  if (!rows.length) continue;
  const idx = rolesOf(c)
    .map((rid) => roleById.get(rid)?.index)
    .filter((n) => n != null);
  const seen = new Map();
  rows.forEach((row, i) => {
    const values = idx.map((n) => row.values?.[n]);
    if (values.some((v) => v == null)) return;
    const k = values.join(' ');
    if (seen.has(k))
      err('population-violates-uniqueness', `Rows ${seen.get(k) + 1} and ${i + 1} of "${label(ft)}" repeat ${values.join(', ')}, which the uniqueness constraint forbids.`);
    else seen.set(k, i);
  });
}

const instancesOf = new Map();
const note = (otId, value) => {
  if (otId == null || value == null) return;
  if (!instancesOf.has(otId)) instancesOf.set(otId, new Set());
  instancesOf.get(otId).add(String(value));
};
for (const ot of objectTypes) for (const v of ot.population ?? []) note(ot.id, v);
for (const ft of factTypes)
  for (const row of ft.population ?? []) (ft.roles ?? []).forEach((role, i) => note(role.objectTypeId, row.values?.[i]));

// A disjunctive mandatory is satisfied when any one of its roles is filled. Like
// Factum, this checks the rows of the constrained fact type rather than trying to
// enumerate every instance of the player.
for (const c of constraints.filter((x) => x.kind === 'mandatory')) {
  const entries = rolesOf(c)
    .map((rid) => roleById.get(rid))
    .filter(Boolean);
  if (!entries.length) continue;
  if (new Set(entries.map((e) => e.factType.id)).size !== 1) continue;
  const ft = entries[0].factType;
  (ft.population ?? []).forEach((row, i) => {
    if (entries.some((e) => row.values?.[e.index] != null)) return;
    err('population-violates-mandatory', `Row ${i + 1} of "${label(ft)}" leaves a mandatory role empty.`);
  });
}

for (const c of constraints.filter((x) => x.kind === 'frequency')) {
  const entries = rolesOf(c)
    .map((rid) => roleById.get(rid))
    .filter(Boolean);
  if (entries.length !== 1) continue;
  const { factType, index } = entries[0];
  const rows = factType.population ?? [];
  if (!rows.length) continue;
  const counts = new Map();
  for (const row of rows) {
    const v = row.values?.[index];
    if (v == null) continue;
    counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  }
  for (const [v, n] of counts)
    if (n < c.min || (c.max != null && n > c.max))
      err('population-violates-frequency', `${v} plays its role in "${label(factType)}" ${n} time(s); the frequency constraint allows ${c.min}..${c.max ?? 'n'}.`);
}

for (const c of constraints.filter((x) => x.kind === 'value' && x.ranges?.length)) {
  const check = (value, where) => {
    if (value == null) return;
    if (!inRange(value, c.ranges)) err('population-violates-value', `${where} has the value ${JSON.stringify(value)}, outside the value constraint "${c.id}".`);
  };
  if (c.roleId != null) {
    const entry = roleById.get(c.roleId);
    if (entry) for (const row of entry.factType.population ?? []) check(row.values?.[entry.index], `A row of "${label(entry.factType)}"`);
  } else if (c.objectTypeId != null) {
    for (const v of instancesOf.get(c.objectTypeId) ?? []) check(v, `${name(c.objectTypeId)}`);
  }
}

/* ------------------------------------------------------------------- hygiene */

const playedTypes = new Set();
for (const ft of factTypes) for (const r of ft.roles ?? []) if (r.objectTypeId) playedTypes.add(r.objectTypeId);
const inHierarchy = new Set(subtypeRelations.flatMap((s) => [s.subtypeId, s.supertypeId]));
for (const ot of objectTypes)
  if (!playedTypes.has(ot.id) && !inHierarchy.has(ot.id) && !ot.objectifiedFactTypeId)
    warn('unused-object-type', `Object type "${ot.name}" plays no role and has no subtypes.`);

/* -------------------------------------------------------------------- report */

const errors = problems.filter((p) => p.severity === 'error');
const warnings = problems.filter((p) => p.severity === 'warning');

if (json) {
  console.log(JSON.stringify({ file: files[0], problems, sampleFacts }, null, 2));
} else if (!problems.length) {
  console.log(`No problems found. ${sampleFacts} sample fact(s).`);
} else {
  for (const p of problems) console.log(`${p.severity.padEnd(7)} ${p.code.padEnd(34)} ${p.message}`);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  console.log(`${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}. ${sampleFacts} sample fact(s).`);
}

process.exit(errors.length || (strict && warnings.length) ? 1 : 0);
