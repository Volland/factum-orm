/**
 * Checks a model's sample population against the constraints drawn on it.
 *
 * This is the Substitution Principle made mechanical: a constraint the modeller
 * drew is only believable if the examples they gave obey it. Where they do not,
 * one of the two is wrong — and either answer is useful, which is why these are
 * reported as errors rather than quietly ignored.
 */

import {
  Constraint,
  FactInstance,
  FactType,
  Id,
  OrmModel,
  ValueRange,
} from '../model/types.js';
import {
  expandReading,
  indexModel,
  instanceValue,
  populationOf,
  primaryReading,
} from '../model/model.js';
import { Issue } from './validate.js';
import { factTypeName } from './verbalize.js';

/** Issues found by comparing the population with the schema. */
export function checkPopulation(model: OrmModel): Issue[] {
  const issues: Issue[] = [];
  const index = indexModel(model);

  for (const ft of model.factTypes) {
    const population = populationOf(ft);
    if (!population.length) continue;

    population.forEach((instance, row) => {
      if (instance.values.length !== ft.roles.length) {
        issues.push({
          severity: 'error',
          code: 'population-arity',
          elementId: ft.id,
          message: `Row ${row + 1} of "${factTypeName(model, ft)}" has ${instance.values.length} value(s) but the fact type has ${ft.roles.length} role(s).`,
        });
      }
    });
  }

  for (const constraint of model.constraints) {
    switch (constraint.kind) {
      case 'uniqueness':
        checkUniqueness(model, index, constraint, issues);
        break;
      case 'mandatory':
        checkMandatory(model, constraint, issues);
        break;
      case 'frequency':
        checkFrequency(model, index, constraint, issues);
        break;
      case 'value':
        checkValue(model, constraint, issues);
        break;
      default:
        break;
    }
  }

  return issues;
}

type Index = ReturnType<typeof indexModel>;

/** Every constrained role must live in one fact type for a population check. */
function ownerOf(index: Index, roles: Id[]): FactType | undefined {
  const owners = new Set(roles.map((r) => index.roleOwner.get(r)?.id));
  if (owners.size !== 1 || owners.has(undefined)) return undefined;
  return index.roleOwner.get(roles[0]);
}

function keyOf(ft: FactType, instance: FactInstance, roles: Id[]): string {
  return JSON.stringify(roles.map((roleId) => instanceValue(ft, instance, roleId)));
}

function checkUniqueness(
  model: OrmModel,
  index: Index,
  constraint: Extract<Constraint, { kind: 'uniqueness' }>,
  issues: Issue[],
): void {
  const ft = ownerOf(index, constraint.roles);
  if (!ft) return; // external uniqueness spans fact types; not checked here
  const population = populationOf(ft);
  if (!population.length) return;

  const seen = new Map<string, number>();
  population.forEach((instance, row) => {
    const key = keyOf(ft, instance, constraint.roles);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, row);
      return;
    }
    issues.push({
      severity: 'error',
      code: 'population-violates-uniqueness',
      elementId: constraint.id,
      message: `Rows ${first + 1} and ${row + 1} of "${factTypeName(model, ft)}" repeat ${describeRoles(model, ft, constraint.roles, instance)}, which the uniqueness constraint forbids.`,
    });
  });
}

function checkMandatory(
  model: OrmModel,
  constraint: Extract<Constraint, { kind: 'mandatory' }>,
  issues: Issue[],
): void {
  // A disjunctive mandatory is satisfied when any one of its roles is filled.
  const byFactType = new Map<Id, Id[]>();
  for (const roleId of constraint.roles) {
    const ft = model.factTypes.find((f) => f.roles.some((r) => r.id === roleId));
    if (!ft) continue;
    byFactType.set(ft.id, [...(byFactType.get(ft.id) ?? []), roleId]);
  }
  if (byFactType.size !== 1) return;

  const [factTypeId, roles] = [...byFactType.entries()][0];
  const ft = model.factTypes.find((f) => f.id === factTypeId);
  if (!ft) return;

  populationOf(ft).forEach((instance, row) => {
    const filled = roles.some((roleId) => instanceValue(ft, instance, roleId) !== null);
    if (filled) return;
    issues.push({
      severity: 'error',
      code: 'population-violates-mandatory',
      elementId: constraint.id,
      message: `Row ${row + 1} of "${factTypeName(model, ft)}" leaves a mandatory role empty.`,
    });
  });
}

function checkFrequency(
  model: OrmModel,
  index: Index,
  constraint: Extract<Constraint, { kind: 'frequency' }>,
  issues: Issue[],
): void {
  const ft = ownerOf(index, constraint.roles);
  if (!ft) return;
  const population = populationOf(ft);
  if (!population.length) return;

  const counts = new Map<string, number>();
  for (const instance of population) {
    const key = keyOf(ft, instance, constraint.roles);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    const tooFew = count < constraint.min;
    const tooMany = constraint.max !== null && count > constraint.max;
    if (!tooFew && !tooMany) continue;
    const bound = constraint.max === null ? `at least ${constraint.min}` : `between ${constraint.min} and ${constraint.max}`;
    issues.push({
      severity: 'error',
      code: 'population-violates-frequency',
      elementId: constraint.id,
      message: `${JSON.parse(key).join(', ')} occurs ${count} time(s) in "${factTypeName(model, ft)}", but the frequency constraint requires ${bound}.`,
    });
  }
}

function checkValue(
  model: OrmModel,
  constraint: Extract<Constraint, { kind: 'value' }>,
  issues: Issue[],
): void {
  const report = (value: string | number | boolean, where: string): void => {
    if (inRanges(value, constraint.ranges)) return;
    issues.push({
      severity: 'error',
      code: 'population-violates-value',
      elementId: constraint.id,
      message: `${JSON.stringify(value)} in ${where} is outside the allowed values ${formatRanges(constraint.ranges)}.`,
    });
  };

  if (constraint.objectTypeId) {
    const ot = model.objectTypes.find((o) => o.id === constraint.objectTypeId);
    for (const value of ot?.population ?? []) report(value, `the population of "${ot?.name}"`);
    // Values reaching the object type through a role are checked too.
    for (const ft of model.factTypes) {
      for (const role of ft.roles) {
        if (role.objectTypeId !== constraint.objectTypeId) continue;
        populationOf(ft).forEach((instance, row) => {
          const value = instanceValue(ft, instance, role.id);
          if (value !== null) report(value, `row ${row + 1} of "${factTypeName(model, ft)}"`);
        });
      }
    }
    return;
  }

  if (!constraint.roleId) return;
  const ft = model.factTypes.find((f) => f.roles.some((r) => r.id === constraint.roleId));
  if (!ft) return;
  populationOf(ft).forEach((instance, row) => {
    const value = instanceValue(ft, instance, constraint.roleId!);
    if (value !== null) report(value, `row ${row + 1} of "${factTypeName(model, ft)}"`);
  });
}

function inRanges(value: string | number | boolean, ranges: ValueRange[]): boolean {
  if (!ranges.length) return true;
  return ranges.some((range) => {
    if (range.value !== undefined) return String(range.value) === String(value);
    const asNumber = Number(value);
    const numeric = Number.isFinite(asNumber) && typeof value !== 'boolean';
    const compare = (bound: string | number | undefined): number | undefined => {
      if (bound === undefined) return undefined;
      const boundNumber = Number(bound);
      if (numeric && Number.isFinite(boundNumber)) return asNumber - boundNumber;
      return String(value).localeCompare(String(bound));
    };
    const low = compare(range.min);
    const high = compare(range.max);
    if (low !== undefined && (range.minInclusive === false ? low <= 0 : low < 0)) return false;
    if (high !== undefined && (range.maxInclusive === false ? high >= 0 : high > 0)) return false;
    return true;
  });
}

function formatRanges(ranges: ValueRange[]): string {
  return `{${ranges
    .map((r) => (r.value !== undefined ? JSON.stringify(r.value) : `${r.min ?? ''}..${r.max ?? ''}`))
    .join(', ')}}`;
}

function describeRoles(model: OrmModel, ft: FactType, roles: Id[], instance: FactInstance): string {
  return roles
    .map((roleId) => JSON.stringify(instanceValue(ft, instance, roleId)))
    .join(', ');
}

/* -------------------------------------------------------------------------- */
/* Substitution                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Each sample tuple read back as a sentence, with the real values substituted
 * into the reading — the check a domain expert can actually perform.
 */
export function verbalizePopulation(model: OrmModel, factType: FactType): string[] {
  const reading = primaryReading(factType);
  if (!reading) return [];
  return populationOf(factType).map((instance) =>
    expandReading(reading, (roleId) => {
      const value = instanceValue(factType, instance, roleId);
      return value === null ? '…' : String(value);
    }),
  );
}

/** Every populated fact type, read back as sentences. */
export function verbalizeAllPopulations(model: OrmModel): { factType: FactType; sentences: string[] }[] {
  return model.factTypes
    .filter((ft) => populationOf(ft).length > 0)
    .map((ft) => ({ factType: ft, sentences: verbalizePopulation(model, ft) }));
}
