import { Constraint, FactType, Id, ObjectType, OrmModel, UniquenessConstraint } from '../model/types.js';
import {
  constraintRoles,
  factTypeOfRole,
  indexModel,
  isInternal,
  ModelIndex,
  objectTypeInlineLabel,
} from '../model/model.js';
import { factTypeName } from './verbalize.js';
import { checkPopulation } from './population.js';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  /** Stable code so users can suppress or search for a rule. */
  code: string;
  message: string;
  /** Element the issue is about; used to locate it in the document and diagram. */
  elementId: Id;
}

/**
 * Checks the well-formedness rules an ORM schema must satisfy before it can be
 * mapped to a relational schema. Errors block mapping, warnings do not.
 */
export function validateModel(model: OrmModel): Issue[] {
  const index = indexModel(model);
  const issues: Issue[] = [];

  checkObjectTypes(model, index, issues);
  checkFactTypes(model, index, issues);
  checkConstraints(model, index, issues);
  checkSubtypes(model, index, issues);
  // A sample population is checked against the constraints drawn on the model:
  // where they disagree, one of the two is wrong and the modeller should know.
  issues.push(...checkPopulation(model));

  return issues;
}

function checkObjectTypes(model: OrmModel, index: ModelIndex, issues: Issue[]): void {
  const byName = new Map<string, ObjectType[]>();
  for (const ot of model.objectTypes) {
    const key = ot.name.trim().toLowerCase();
    const list = byName.get(key);
    if (list) list.push(ot);
    else byName.set(key, [ot]);
  }
  for (const [, list] of byName) {
    if (list.length < 2) continue;
    for (const ot of list) {
      issues.push({
        severity: 'error',
        code: 'duplicate-object-type-name',
        elementId: ot.id,
        message: `Duplicate object type name "${ot.name}". Object type names must be unique in a model.`,
      });
    }
  }

  for (const ot of model.objectTypes) {
    if (!ot.name.trim()) {
      issues.push({
        severity: 'error',
        code: 'unnamed-object-type',
        elementId: ot.id,
        message: 'Object type has no name.',
      });
    }

    if (ot.kind === 'entity' && !hasReferenceScheme(model, index, ot)) {
      issues.push({
        severity: 'error',
        code: 'no-reference-scheme',
        elementId: ot.id,
        message: `Entity type "${ot.name}" has no reference scheme. Give it a reference mode, a preferred identifier, an objectified fact type, or make it a subtype.`,
      });
    }

    if (ot.kind === 'value' && ot.refMode) {
      issues.push({
        severity: 'warning',
        code: 'value-type-ref-mode',
        elementId: ot.id,
        message: `Value type "${ot.name}" has a reference mode. Value types identify themselves lexically; the reference mode is ignored.`,
      });
    }

    if (ot.objectifiedFactTypeId && !index.factTypes.has(ot.objectifiedFactTypeId)) {
      issues.push({
        severity: 'error',
        code: 'dangling-objectification',
        elementId: ot.id,
        message: `"${ot.name}" objectifies a fact type that does not exist.`,
      });
    }

    const played = index.playedRoles.get(ot.id) ?? [];
    const isSupertype = model.subtypeRelations.some((s) => s.supertypeId === ot.id);
    const isSubtype = model.subtypeRelations.some((s) => s.subtypeId === ot.id);
    if (!played.length && !isSupertype && !isSubtype && !ot.isIndependent && !ot.objectifiedFactTypeId) {
      issues.push({
        severity: 'warning',
        code: 'unused-object-type',
        elementId: ot.id,
        message: `Object type "${objectTypeInlineLabel(ot)}" plays no fact roles and is not a subtype or supertype.`,
      });
    }
  }

  const objectified = new Map<Id, ObjectType[]>();
  for (const ot of model.objectTypes) {
    if (!ot.objectifiedFactTypeId) continue;
    const list = objectified.get(ot.objectifiedFactTypeId);
    if (list) list.push(ot);
    else objectified.set(ot.objectifiedFactTypeId, [ot]);
  }
  for (const [factTypeId, owners] of objectified) {
    if (owners.length < 2) continue;
    for (const owner of owners) {
      issues.push({
        severity: 'error',
        code: 'multiple-objectification',
        elementId: owner.id,
        message: `Fact type ${factTypeId} is objectified by more than one object type (${owners
          .map((o) => o.name)
          .join(', ')}).`,
      });
    }
  }
}

function hasReferenceScheme(model: OrmModel, index: ModelIndex, ot: ObjectType): boolean {
  if (ot.refMode) return true;
  if (ot.objectifiedFactTypeId) return true;
  if (model.subtypeRelations.some((s) => s.subtypeId === ot.id)) return true;
  // An explicit preferred identifier: a uniqueness constraint over roles opposite this type.
  return model.constraints.some((c) => {
    if (c.kind !== 'uniqueness' || !c.isPreferredIdentifier) return false;
    return c.roles.some((roleId) => {
      const ft = index.roleOwner.get(roleId);
      return !!ft && ft.roles.some((r) => r.id !== roleId && r.objectTypeId === ot.id);
    });
  });
}

function checkFactTypes(model: OrmModel, index: ModelIndex, issues: Issue[]): void {
  for (const ft of model.factTypes) {
    if (!ft.roles.length) {
      issues.push({
        severity: 'error',
        code: 'empty-fact-type',
        elementId: ft.id,
        message: 'Fact type has no roles.',
      });
      continue;
    }

    for (const role of ft.roles) {
      if (!role.objectTypeId) {
        issues.push({
          severity: 'error',
          code: 'unattached-role',
          elementId: ft.id,
          message: `A role of "${factTypeName(model, ft)}" is not connected to an object type.`,
        });
      } else if (!index.objectTypes.has(role.objectTypeId)) {
        issues.push({
          severity: 'error',
          code: 'dangling-role-player',
          elementId: ft.id,
          message: `A role of "${factTypeName(model, ft)}" refers to a missing object type (${role.objectTypeId}).`,
        });
      }
    }

    if (!ft.readings.length) {
      issues.push({
        severity: 'error',
        code: 'no-reading',
        elementId: ft.id,
        message: 'Fact type has no reading. Every fact type needs at least one predicate reading.',
      });
    }

    for (const reading of ft.readings) {
      const placeholders = [...reading.text.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
      const distinct = new Set(placeholders);
      if (distinct.size !== ft.roles.length) {
        issues.push({
          severity: 'error',
          code: 'reading-arity-mismatch',
          elementId: ft.id,
          message: `Reading "${reading.text}" uses ${distinct.size} placeholder(s) but the fact type has ${ft.roles.length} role(s).`,
        });
      }
      if (placeholders.some((p) => p >= reading.roleOrder.length)) {
        issues.push({
          severity: 'error',
          code: 'reading-placeholder-range',
          elementId: ft.id,
          message: `Reading "${reading.text}" refers to a role position that does not exist.`,
        });
      }
      if (reading.roleOrder.length !== ft.roles.length) {
        issues.push({
          severity: 'error',
          code: 'reading-role-order',
          elementId: ft.id,
          message: `Reading "${reading.text}" lists ${reading.roleOrder.length} role(s) but the fact type has ${ft.roles.length}.`,
        });
      }
    }

    checkFactTypeUniqueness(model, ft, issues);
  }
}

/**
 * ORM requires each fact type to be elementary: every fact type carries at
 * least one uniqueness constraint, and for an n-ary fact type each internal
 * uniqueness constraint must span at least n-1 roles.
 */
function checkFactTypeUniqueness(model: OrmModel, ft: FactType, issues: Issue[]): void {
  const roleIds = new Set(ft.roles.map((r) => r.id));
  const internalUniqueness = model.constraints.filter(
    (c): c is UniquenessConstraint =>
      c.kind === 'uniqueness' && c.roles.length > 0 && c.roles.every((r) => roleIds.has(r)),
  );

  if (!internalUniqueness.length) {
    issues.push({
      severity: 'error',
      code: 'missing-uniqueness',
      elementId: ft.id,
      message: `Fact type "${factTypeName(model, ft)}" has no uniqueness constraint. Add one to say how many times a fact may be repeated.`,
    });
    return;
  }

  const arity = ft.roles.length;
  for (const constraint of internalUniqueness) {
    if (constraint.roles.length < arity - 1) {
      issues.push({
        severity: 'error',
        code: 'uniqueness-too-narrow',
        elementId: constraint.id,
        message: `An internal uniqueness constraint on "${factTypeName(model, ft)}" spans ${
          constraint.roles.length
        } of ${arity} roles. It must span at least ${arity - 1}; otherwise the fact type is not elementary and should be split.`,
      });
    }
  }

  if (arity > 1 && internalUniqueness.every((c) => c.roles.length === arity)) {
    const spanning = internalUniqueness.find((c) => c.roles.length === arity)!;
    if (internalUniqueness.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'redundant-spanning-uniqueness',
        elementId: spanning.id,
        message: `"${factTypeName(model, ft)}" has a spanning uniqueness constraint alongside narrower ones; the spanning constraint is implied.`,
      });
    }
  }
}

function checkConstraints(model: OrmModel, index: ModelIndex, issues: Issue[]): void {
  for (const constraint of model.constraints) {
    for (const roleId of constraintRoles(constraint)) {
      if (!index.roles.has(roleId)) {
        issues.push({
          severity: 'error',
          code: 'dangling-constraint-role',
          elementId: constraint.id,
          message: `${describeConstraint(constraint)} refers to a role that no longer exists (${roleId}).`,
        });
      }
    }

    switch (constraint.kind) {
      case 'uniqueness':
      case 'mandatory':
        if (!constraint.roles.length) {
          issues.push({
            severity: 'error',
            code: 'empty-constraint',
            elementId: constraint.id,
            message: `${describeConstraint(constraint)} constrains no roles.`,
          });
        }
        if (constraint.kind === 'mandatory' && constraint.roles.length > 1) {
          const players = new Set(
            constraint.roles.map((roleId) => index.roles.get(roleId)?.objectTypeId).filter(Boolean),
          );
          if (players.size > 1) {
            issues.push({
              severity: 'error',
              code: 'mandatory-player-mismatch',
              elementId: constraint.id,
              message: 'A disjunctive mandatory constraint must span roles played by the same object type.',
            });
          }
        }
        break;

      case 'frequency':
        if (constraint.min < 1 || (constraint.max !== null && constraint.max < constraint.min)) {
          issues.push({
            severity: 'error',
            code: 'bad-frequency-range',
            elementId: constraint.id,
            message: `Frequency range ${constraint.min}..${constraint.max ?? 'n'} is invalid.`,
          });
        }
        if (constraint.min === 1 && constraint.max === 1) {
          issues.push({
            severity: 'warning',
            code: 'frequency-is-uniqueness',
            elementId: constraint.id,
            message: 'A frequency of exactly 1 is a uniqueness constraint; use a uniqueness constraint instead.',
          });
        }
        break;

      case 'ring': {
        const [a, b] = constraint.roles;
        const roleA = index.roles.get(a);
        const roleB = index.roles.get(b);
        if (roleA && roleB && roleA.objectTypeId !== roleB.objectTypeId) {
          const compatible =
            !!roleA.objectTypeId &&
            !!roleB.objectTypeId &&
            sharesSupertype(model, roleA.objectTypeId, roleB.objectTypeId);
          if (!compatible) {
            issues.push({
              severity: 'error',
              code: 'ring-incompatible-roles',
              elementId: constraint.id,
              message: 'A ring constraint requires both roles to be played by the same object type or by types with a common supertype.',
            });
          }
        }
        if (!constraint.types.length) {
          issues.push({
            severity: 'error',
            code: 'empty-ring',
            elementId: constraint.id,
            message: 'Ring constraint has no ring type selected.',
          });
        }
        if (constraint.types.includes('symmetric') && constraint.types.includes('asymmetric')) {
          issues.push({
            severity: 'error',
            code: 'contradictory-ring',
            elementId: constraint.id,
            message: 'A ring constraint cannot be both symmetric and asymmetric.',
          });
        }
        break;
      }

      case 'subset':
      case 'exclusion':
      case 'equality': {
        if (constraint.roleSequences.length < 2) {
          issues.push({
            severity: 'error',
            code: 'set-constraint-arity',
            elementId: constraint.id,
            message: `${describeConstraint(constraint)} needs at least two role sequences.`,
          });
          break;
        }
        const length = constraint.roleSequences[0].length;
        if (constraint.roleSequences.some((seq) => seq.length !== length)) {
          issues.push({
            severity: 'error',
            code: 'set-constraint-length',
            elementId: constraint.id,
            message: `${describeConstraint(constraint)} compares role sequences of different lengths.`,
          });
          break;
        }
        for (let position = 0; position < length; position += 1) {
          const players = constraint.roleSequences.map(
            (seq) => index.roles.get(seq[position])?.objectTypeId ?? undefined,
          );
          const distinct = new Set(players.filter(Boolean));
          if (distinct.size > 1) {
            const compatible = [...distinct].every(
              (id, _i, all) => all.every((other) => id === other || sharesSupertype(model, id!, other!)),
            );
            if (!compatible) {
              issues.push({
                severity: 'error',
                code: 'set-constraint-compatibility',
                elementId: constraint.id,
                message: `${describeConstraint(constraint)} compares roles at position ${
                  position + 1
                } played by incompatible object types.`,
              });
            }
          }
        }
        if (constraint.kind === 'subset') {
          const subsetRoles = constraint.roleSequences[0];
          const supersetRoles = constraint.roleSequences[1];
          const subsetMandatory = subsetRoles.every((roleId) =>
            model.constraints.some((c) => c.kind === 'mandatory' && c.roles.length === 1 && c.roles[0] === roleId),
          );
          const supersetOptional = !supersetRoles.every((roleId) =>
            model.constraints.some((c) => c.kind === 'mandatory' && c.roles.length === 1 && c.roles[0] === roleId),
          );
          if (subsetMandatory && supersetOptional) {
            issues.push({
              severity: 'warning',
              code: 'implied-mandatory',
              elementId: constraint.id,
              message: 'The subset constraint starts from mandatory roles, which makes the superset roles mandatory too.',
            });
          }
        }
        break;
      }

      case 'value':
        if (!constraint.ranges.length) {
          issues.push({
            severity: 'error',
            code: 'empty-value-constraint',
            elementId: constraint.id,
            message: 'Value constraint lists no values.',
          });
        }
        if (!constraint.objectTypeId && !constraint.roleId) {
          issues.push({
            severity: 'error',
            code: 'untargeted-value-constraint',
            elementId: constraint.id,
            message: 'Value constraint targets neither an object type nor a role.',
          });
        }
        if (constraint.objectTypeId && !index.objectTypes.has(constraint.objectTypeId)) {
          issues.push({
            severity: 'error',
            code: 'dangling-value-constraint',
            elementId: constraint.id,
            message: 'Value constraint targets a missing object type.',
          });
        }
        break;

      case 'cardinality':
        if (constraint.min < 0 || (constraint.max !== null && constraint.max < constraint.min)) {
          issues.push({
            severity: 'error',
            code: 'bad-cardinality-range',
            elementId: constraint.id,
            message: `Cardinality range ${constraint.min}..${constraint.max ?? 'n'} is invalid.`,
          });
        }
        break;

      case 'subtypeSet': {
        if (!index.objectTypes.has(constraint.supertypeId)) {
          issues.push({
            severity: 'error',
            code: 'dangling-subtype-set',
            elementId: constraint.id,
            message: 'Subtype constraint refers to a missing supertype.',
          });
        }
        const bad = constraint.subtypeRelationIds.filter((id) => {
          const rel = index.subtypeRelations.get(id);
          return !rel || rel.supertypeId !== constraint.supertypeId;
        });
        if (bad.length) {
          issues.push({
            severity: 'error',
            code: 'subtype-set-mismatch',
            elementId: constraint.id,
            message: 'Subtype constraint includes subtype links that do not share its supertype.',
          });
        }
        break;
      }
    }

    // External uniqueness needs roles from at least two fact types.
    if (constraint.kind === 'uniqueness' && constraint.roles.length > 1 && !isInternal(model, constraint)) {
      const owners = new Set(constraint.roles.map((r) => factTypeOfRole(model, r)?.id));
      if (owners.has(undefined)) continue;
      if (owners.size < 2) continue;
      const arities = constraint.roles.map((r) => factTypeOfRole(model, r)?.roles.length ?? 0);
      if (arities.some((a) => a === 1)) {
        issues.push({
          severity: 'error',
          code: 'external-uniqueness-unary',
          elementId: constraint.id,
          message: 'An external uniqueness constraint cannot include a role from a unary fact type.',
        });
      }
    }
  }
}

function checkSubtypes(model: OrmModel, index: ModelIndex, issues: Issue[]): void {
  for (const relation of model.subtypeRelations) {
    const sub = index.objectTypes.get(relation.subtypeId);
    const sup = index.objectTypes.get(relation.supertypeId);
    if (!sub || !sup) {
      issues.push({
        severity: 'error',
        code: 'dangling-subtype',
        elementId: relation.id,
        message: 'Subtype link refers to a missing object type.',
      });
      continue;
    }
    if (relation.subtypeId === relation.supertypeId) {
      issues.push({
        severity: 'error',
        code: 'self-subtype',
        elementId: relation.id,
        message: `"${sub.name}" cannot be a subtype of itself.`,
      });
      continue;
    }
    if (sub.kind !== sup.kind) {
      issues.push({
        severity: 'error',
        code: 'subtype-kind-mismatch',
        elementId: relation.id,
        message: `"${sub.name}" (${sub.kind} type) cannot be a subtype of "${sup.name}" (${sup.kind} type).`,
      });
    }
  }

  for (const cycle of findSubtypeCycles(model)) {
    for (const relationId of cycle) {
      issues.push({
        severity: 'error',
        code: 'subtype-cycle',
        elementId: relationId,
        message: 'Subtype links form a cycle.',
      });
    }
  }

  // A subtype with several supertypes should say which path identifies it.
  const bySubtype = new Map<Id, string[]>();
  for (const relation of model.subtypeRelations) {
    const list = bySubtype.get(relation.subtypeId);
    if (list) list.push(relation.id);
    else bySubtype.set(relation.subtypeId, [relation.id]);
  }
  for (const [subtypeId, relationIds] of bySubtype) {
    if (relationIds.length < 2) continue;
    const paths = relationIds.filter(
      (id) => index.subtypeRelations.get(id)?.isPreferredIdentificationPath,
    );
    if (paths.length !== 1) {
      issues.push({
        severity: 'warning',
        code: 'ambiguous-identification-path',
        elementId: subtypeId,
        message: `"${index.objectTypes.get(subtypeId)?.name ?? subtypeId}" has several supertypes; mark exactly one link as the preferred identification path.`,
      });
    }
  }
}

function findSubtypeCycles(model: OrmModel): Id[][] {
  const cycles: Id[][] = [];
  const state = new Map<Id, 'visiting' | 'done'>();
  const stack: { objectTypeId: Id; relationId: Id }[] = [];

  const visit = (objectTypeId: Id): void => {
    if (state.get(objectTypeId) === 'done') return;
    if (state.get(objectTypeId) === 'visiting') {
      const start = stack.findIndex((entry) => entry.objectTypeId === objectTypeId);
      if (start >= 0) cycles.push(stack.slice(start).map((entry) => entry.relationId));
      return;
    }
    state.set(objectTypeId, 'visiting');
    for (const relation of model.subtypeRelations) {
      if (relation.subtypeId !== objectTypeId) continue;
      stack.push({ objectTypeId, relationId: relation.id });
      visit(relation.supertypeId);
      stack.pop();
    }
    state.set(objectTypeId, 'done');
  };

  for (const ot of model.objectTypes) visit(ot.id);
  return cycles;
}

function sharesSupertype(model: OrmModel, a: Id, b: Id): boolean {
  const ancestors = (id: Id): Set<Id> => {
    const seen = new Set<Id>([id]);
    const queue = [id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const relation of model.subtypeRelations) {
        if (relation.subtypeId !== current || seen.has(relation.supertypeId)) continue;
        seen.add(relation.supertypeId);
        queue.push(relation.supertypeId);
      }
    }
    return seen;
  };
  const left = ancestors(a);
  const right = ancestors(b);
  for (const id of left) if (right.has(id)) return true;
  return false;
}

function describeConstraint(constraint: Constraint): string {
  switch (constraint.kind) {
    case 'uniqueness':
      return 'Uniqueness constraint';
    case 'mandatory':
      return 'Mandatory constraint';
    case 'frequency':
      return 'Frequency constraint';
    case 'ring':
      return 'Ring constraint';
    case 'subset':
      return 'Subset constraint';
    case 'exclusion':
      return 'Exclusion constraint';
    case 'equality':
      return 'Equality constraint';
    case 'value':
      return 'Value constraint';
    case 'cardinality':
      return 'Cardinality constraint';
    case 'subtypeSet':
      return 'Subtype constraint';
  }
}

/** Convenience used by the mapper: mapping requires an error-free schema. */
export function hasBlockingErrors(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

export function summarize(issues: Issue[]): string {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  if (!errors && !warnings) return 'No problems found.';
  return `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.`;
}
