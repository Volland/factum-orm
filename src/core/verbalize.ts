import {
  Constraint,
  FactType,
  Id,
  ObjectType,
  OrmModel,
  Reading,
  RingType,
  SetComparisonConstraint,
  ValueRange,
} from '../model/types.js';
import {
  expandReading,
  factTypeOfRole,
  indexModel,
  isInternal,
  ModelIndex,
  objectTypeInlineLabel,
  predicateText,
  primaryReading,
  readingStartingAt,
} from '../model/model.js';

export interface VerbalizationLine {
  /** Element the line describes, so the UI can select it on click. */
  targetId: Id;
  kind: 'factType' | 'constraint' | 'objectType' | 'subtype';
  text: string;
  /** Deontic constraints are rendered in blue by convention. */
  modality?: 'alethic' | 'deontic';
}

export interface VerbalizationGroup {
  id: Id;
  title: string;
  kind: 'objectType' | 'factType' | 'subtype' | 'constraint';
  lines: VerbalizationLine[];
}

export interface VerbalizeOptions {
  /** `plain` drops the FORML "It is possible that" style hedging. */
  mode?: 'forml' | 'plain';
}

/* -------------------------------------------------------------------------- */
/* Entry points                                                                */
/* -------------------------------------------------------------------------- */

export function verbalizeModel(model: OrmModel, options: VerbalizeOptions = {}): VerbalizationGroup[] {
  const index = indexModel(model);
  const groups: VerbalizationGroup[] = [];

  for (const ot of model.objectTypes) {
    const lines = verbalizeObjectType(model, index, ot, options);
    if (lines.length) {
      groups.push({ id: ot.id, title: objectTypeInlineLabel(ot), kind: 'objectType', lines });
    }
  }

  for (const ft of model.factTypes) {
    groups.push({
      id: ft.id,
      title: factTypeName(model, ft),
      kind: 'factType',
      lines: verbalizeFactType(model, index, ft, options),
    });
  }

  const subtypeLines = model.subtypeRelations.flatMap((s) => {
    const sub = index.objectTypes.get(s.subtypeId);
    const sup = index.objectTypes.get(s.supertypeId);
    if (!sub || !sup) return [];
    return [{ targetId: s.id, kind: 'subtype' as const, text: `Each ${sub.name} is a kind of ${sup.name}.` }];
  });
  for (const constraint of model.constraints) {
    if (constraint.kind !== 'subtypeSet') continue;
    const text = verbalizeConstraint(model, index, constraint, options);
    if (text) subtypeLines.push({ targetId: constraint.id, kind: 'subtype', text });
  }
  if (subtypeLines.length) {
    groups.push({ id: 'subtypes', title: 'Subtypes', kind: 'subtype', lines: subtypeLines });
  }

  const external = model.constraints.filter(
    (c) => c.kind !== 'subtypeSet' && !isElementLevel(c) && !isInternal(model, c),
  );
  if (external.length) {
    groups.push({
      id: 'external',
      title: 'External constraints',
      kind: 'constraint',
      lines: external.flatMap((c) => {
        const text = verbalizeConstraint(model, index, c, options);
        return text ? [{ targetId: c.id, kind: 'constraint' as const, text, modality: c.modality }] : [];
      }),
    });
  }

  return groups;
}

/** Flat text rendering, used by the "Verbalize Model" command. */
export function verbalizeModelAsText(model: OrmModel, options: VerbalizeOptions = {}): string {
  const groups = verbalizeModel(model, options);
  const out: string[] = [`# ${model.name} — verbalization`, ''];
  for (const group of groups) {
    if (!group.lines.length) continue;
    out.push(`## ${group.title}`, '');
    for (const line of group.lines) out.push(`- ${line.text}`);
    out.push('');
  }
  return out.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Object types                                                                */
/* -------------------------------------------------------------------------- */

function verbalizeObjectType(
  model: OrmModel,
  index: ModelIndex,
  ot: ObjectType,
  options: VerbalizeOptions,
): VerbalizationLine[] {
  const lines: VerbalizationLine[] = [];

  if (ot.kind === 'entity' && ot.refMode) {
    // The reference mode abbreviates an injective binary fact type.
    const valueTypeName = `${ot.name}${capitalize(ot.refMode)}`;
    lines.push({
      targetId: ot.id,
      kind: 'objectType',
      text: `Each ${ot.name} has exactly one ${valueTypeName}; each ${valueTypeName} refers to at most one ${ot.name}.`,
    });
  }

  if (ot.objectifiedFactTypeId) {
    const nested = index.factTypes.get(ot.objectifiedFactTypeId);
    if (nested) {
      lines.push({
        targetId: ot.id,
        kind: 'objectType',
        text: `Each ${ot.name} objectifies exactly one "${factTypeName(model, nested)}" fact.`,
      });
    }
  }

  if (ot.isIndependent) {
    lines.push({
      targetId: ot.id,
      kind: 'objectType',
      text: `${ot.name} is independent: it may have instances that play no fact roles.`,
    });
  }

  for (const constraint of model.constraints) {
    if (constraint.kind === 'value' && constraint.objectTypeId === ot.id) {
      lines.push({
        targetId: constraint.id,
        kind: 'constraint',
        modality: constraint.modality,
        text: `${modalPrefix(constraint, options)}the possible values of ${ot.name} are ${formatRanges(constraint.ranges)}.`,
      });
    }
    if (constraint.kind === 'cardinality' && constraint.objectTypeId === ot.id) {
      lines.push({
        targetId: constraint.id,
        kind: 'constraint',
        modality: constraint.modality,
        text: `${modalPrefix(constraint, options)}the number of ${plural(ot.name)} is ${cardinalityPhrase(constraint.min, constraint.max)}.`,
      });
    }
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/* Fact types                                                                  */
/* -------------------------------------------------------------------------- */

export function factTypeName(model: OrmModel, ft: FactType): string {
  const reading = primaryReading(ft);
  if (!reading) return '(unnamed fact type)';
  return expandReading(reading, (roleId) => rolePlayerName(model, roleId));
}

function verbalizeFactType(
  model: OrmModel,
  index: ModelIndex,
  ft: FactType,
  options: VerbalizeOptions,
): VerbalizationLine[] {
  const lines: VerbalizationLine[] = [];
  const forml = (options.mode ?? 'forml') === 'forml';

  const reading = primaryReading(ft);
  if (reading && forml) {
    lines.push({
      targetId: ft.id,
      kind: 'factType',
      text: `It is possible that ${expandReading(reading, (roleId) => `some ${rolePlayerName(model, roleId)}`)}.`,
    });
  }

  if (ft.isDerived) {
    const rule = ft.derivationRule ? ` Derivation rule: ${ft.derivationRule}` : '';
    lines.push({
      targetId: ft.id,
      kind: 'factType',
      text: `${factTypeName(model, ft)} is derived${ft.isStored ? ' and stored' : ''}.${rule}`,
    });
  }

  const internal = model.constraints.filter((c) => c.kind !== 'subtypeSet' && ownsAllRoles(ft, c));
  const covered = new Set<Id>();

  // Uniqueness (combined with mandatory where both apply) reads best first.
  for (const constraint of internal) {
    if (constraint.kind !== 'uniqueness') continue;
    const text = verbalizeInternalUniqueness(model, ft, constraint.roles, constraint.isPreferredIdentifier, options);
    if (!text) continue;
    lines.push({ targetId: constraint.id, kind: 'constraint', text, modality: constraint.modality });
    if (constraint.roles.length === 1 && ft.roles.length === 2) {
      const mandatory = internal.find(
        (c) => c.kind === 'mandatory' && c.roles.length === 1 && c.roles[0] === constraint.roles[0],
      );
      if (mandatory) covered.add(mandatory.id);
    }
  }

  for (const constraint of internal) {
    if (constraint.kind === 'uniqueness' || covered.has(constraint.id)) continue;
    const text = verbalizeConstraint(model, index, constraint, options);
    if (text) lines.push({ targetId: constraint.id, kind: 'constraint', text, modality: constraint.modality });
  }

  return lines;
}

function ownsAllRoles(ft: FactType, constraint: Constraint): boolean {
  const owned = new Set(ft.roles.map((r) => r.id));
  const roles = constraintRoleIds(constraint);
  return roles.length > 0 && roles.every((r) => owned.has(r));
}

function constraintRoleIds(constraint: Constraint): Id[] {
  switch (constraint.kind) {
    case 'uniqueness':
    case 'mandatory':
    case 'frequency':
      return constraint.roles;
    case 'ring':
      return [...constraint.roles];
    case 'subset':
    case 'exclusion':
    case 'equality':
      return constraint.roleSequences.flat();
    case 'value':
    case 'cardinality':
      return constraint.roleId ? [constraint.roleId] : [];
    default:
      return [];
  }
}

/**
 * Binary uniqueness reads naturally ("Each Person works for at most one
 * Company"); higher arities fall back to NORMA's combination phrasing.
 */
function verbalizeInternalUniqueness(
  model: OrmModel,
  ft: FactType,
  roleIds: Id[],
  isPreferred: boolean | undefined,
  options: VerbalizeOptions,
): string | undefined {
  const spanned = ft.roles.filter((r) => roleIds.includes(r.id));
  if (!spanned.length) return undefined;
  const remaining = ft.roles.filter((r) => !roleIds.includes(r.id));
  const preferredSuffix = isPreferred ? ' (preferred identifier)' : '';

  if (ft.roles.length === 1) {
    return `Each ${rolePlayerName(model, ft.roles[0].id)} ${predicateAfterFirst(ft, ft.roles[0].id)} at most once.${preferredSuffix}`;
  }

  if (ft.roles.length === 2 && spanned.length === 1) {
    const from = spanned[0];
    const to = remaining[0];
    const reading = readingStartingAt(ft, from.id) ?? primaryReading(ft);
    if (!reading) return undefined;
    const mandatory = model.constraints.some(
      (c) => c.kind === 'mandatory' && c.roles.length === 1 && c.roles[0] === from.id,
    );
    const quantifier = mandatory ? 'exactly one' : 'at most one';
    if (reading.roleOrder[0] === from.id) {
      return `${expandReading(reading, (roleId) =>
        roleId === from.id ? `Each ${rolePlayerName(model, roleId)}` : `${quantifier} ${rolePlayerName(model, roleId)}`,
      )}.${preferredSuffix}`;
    }
    // No reading starts at the constrained role: fall back to an explicit phrasing.
    return `Each ${rolePlayerName(model, from.id)} is related to ${quantifier} ${rolePlayerName(
      model,
      to.id,
    )} in "${factTypeName(model, ft)}".${preferredSuffix}`;
  }

  if (spanned.length === ft.roles.length) {
    const names = spanned.map((r) => rolePlayerName(model, r.id));
    return `In each population of "${factTypeName(model, ft)}", each ${commaList(
      names,
    )} combination occurs at most once.${preferredSuffix}`;
  }

  const spannedNames = spanned.map((r) => rolePlayerName(model, r.id));
  const remainingNames = remaining.map((r) => rolePlayerName(model, r.id));
  return `For each ${joinList(spannedNames, 'and')}, at most one ${joinList(
    remainingNames,
    'and',
  )} is related in "${factTypeName(model, ft)}".${preferredSuffix}`;
}

/* -------------------------------------------------------------------------- */
/* Constraints                                                                 */
/* -------------------------------------------------------------------------- */

export function verbalizeConstraint(
  model: OrmModel,
  index: ModelIndex,
  constraint: Constraint,
  options: VerbalizeOptions = {},
): string | undefined {
  const prefix = modalPrefix(constraint, options);
  switch (constraint.kind) {
    case 'uniqueness': {
      const ft = factTypeOfRole(model, constraint.roles[0]);
      if (ft && isInternal(model, constraint)) {
        return verbalizeInternalUniqueness(model, ft, constraint.roles, constraint.isPreferredIdentifier, options);
      }
      const names = constraint.roles.map((r) => rolePlayerName(model, r));
      const target = externalUniquenessTarget(model, constraint.roles);
      const tail = target ? ` refers to at most one ${target}` : ' occurs at most once';
      return `${prefix}each combination of ${joinList(unique(names), 'and')}${tail}.${
        constraint.isPreferredIdentifier ? ' (preferred identifier)' : ''
      }`;
    }
    case 'mandatory': {
      if (constraint.roles.length === 1) {
        const roleId = constraint.roles[0];
        const ft = factTypeOfRole(model, roleId);
        if (!ft) return undefined;
        const reading = readingStartingAt(ft, roleId) ?? primaryReading(ft);
        if (reading && reading.roleOrder[0] === roleId) {
          return `${prefix}${expandReading(reading, (id) =>
            id === roleId ? `each ${rolePlayerName(model, id)}` : `some ${rolePlayerName(model, id)}`,
          )}.`;
        }
        return `${prefix}each ${rolePlayerName(model, roleId)} plays a role in "${factTypeName(model, ft)}".`;
      }
      const first = rolePlayerName(model, constraint.roles[0]);
      const readings = constraint.roles.map((roleId) => {
        const ft = factTypeOfRole(model, roleId);
        return ft ? factTypeName(model, ft) : '?';
      });
      return `${prefix}each ${first} participates in at least one of: ${joinList(unique(readings), 'or')}.`;
    }
    case 'frequency': {
      const names = constraint.roles.map((r) => rolePlayerName(model, r));
      const ft = factTypeOfRole(model, constraint.roles[0]);
      const where = ft ? ` in "${factTypeName(model, ft)}"` : '';
      return `${prefix}each ${joinList(unique(names), 'and')} that plays the constrained role${
        constraint.roles.length > 1 ? 's' : ''
      }${where} does so ${frequencyPhrase(constraint.min, constraint.max)}.`;
    }
    case 'ring': {
      const ft = factTypeOfRole(model, constraint.roles[0]);
      if (!ft) return undefined;
      const player = rolePlayerName(model, constraint.roles[0]);
      const name = factTypeName(model, ft);
      const phrases = constraint.types.map((t) => ringPhrase(t, player, name));
      return `${prefix}${joinList(phrases, 'and')}.`;
    }
    case 'subset':
    case 'exclusion':
    case 'equality':
      return verbalizeSetComparison(model, constraint, prefix);
    case 'value': {
      if (constraint.roleId) {
        const player = rolePlayerName(model, constraint.roleId);
        const ft = factTypeOfRole(model, constraint.roleId);
        const where = ft ? ` in "${factTypeName(model, ft)}"` : '';
        return `${prefix}the ${player} playing the constrained role${where} must be ${formatRanges(constraint.ranges)}.`;
      }
      const ot = constraint.objectTypeId ? index.objectTypes.get(constraint.objectTypeId) : undefined;
      if (!ot) return undefined;
      return `${prefix}the possible values of ${ot.name} are ${formatRanges(constraint.ranges)}.`;
    }
    case 'cardinality': {
      if (constraint.roleId) {
        const player = rolePlayerName(model, constraint.roleId);
        return `${prefix}the number of ${plural(player)} playing the constrained role is ${cardinalityPhrase(
          constraint.min,
          constraint.max,
        )}.`;
      }
      const ot = constraint.objectTypeId ? index.objectTypes.get(constraint.objectTypeId) : undefined;
      if (!ot) return undefined;
      return `${prefix}the number of ${plural(ot.name)} is ${cardinalityPhrase(constraint.min, constraint.max)}.`;
    }
    case 'subtypeSet': {
      const supertype = index.objectTypes.get(constraint.supertypeId);
      if (!supertype) return undefined;
      const subtypes = constraint.subtypeRelationIds
        .map((id) => index.subtypeRelations.get(id))
        .map((rel) => (rel ? index.objectTypes.get(rel.subtypeId)?.name : undefined))
        .filter((n): n is string => !!n);
      if (subtypes.length < 2) return undefined;
      if (constraint.isExclusive && constraint.isExhaustive) {
        return `${prefix}each ${supertype.name} is exactly one of: ${joinList(subtypes, 'or')}.`;
      }
      if (constraint.isExclusive) {
        return `${prefix}no ${supertype.name} is both ${joinList(subtypes, 'and')}.`;
      }
      if (constraint.isExhaustive) {
        return `${prefix}each ${supertype.name} is at least one of: ${joinList(subtypes, 'or')}.`;
      }
      return undefined;
    }
  }
}

function verbalizeSetComparison(model: OrmModel, constraint: SetComparisonConstraint, prefix: string): string | undefined {
  const sequences = constraint.roleSequences.map((seq) => describeRoleSequence(model, seq));
  if (sequences.length < 2 || sequences.some((s) => !s)) return undefined;
  switch (constraint.kind) {
    case 'subset':
      return `${prefix}if ${sequences[0]} then ${sequences[1]}.`;
    case 'exclusion':
      return `${prefix}no ${commonPlayers(model, constraint)} both ${joinList(sequences as string[], 'and')}.`;
    case 'equality':
      return `${prefix}${sequences[0]} if and only if ${sequences[1]}.`;
  }
}

function describeRoleSequence(model: OrmModel, roleIds: Id[]): string | undefined {
  const ft = factTypeOfRole(model, roleIds[0]);
  if (!ft) return undefined;
  const reading = readingStartingAt(ft, roleIds[0]) ?? primaryReading(ft);
  if (!reading) return undefined;
  return expandReading(reading, (roleId) =>
    roleIds.includes(roleId) ? `some ${rolePlayerName(model, roleId)}` : `some ${rolePlayerName(model, roleId)}`,
  );
}

function commonPlayers(model: OrmModel, constraint: SetComparisonConstraint): string {
  const first = constraint.roleSequences[0].map((r) => rolePlayerName(model, r));
  return joinList(unique(first), 'and');
}

function externalUniquenessTarget(model: OrmModel, roleIds: Id[]): string | undefined {
  // The identified type is the one playing the opposite role in every fact type.
  const candidates = roleIds.map((roleId) => {
    const ft = factTypeOfRole(model, roleId);
    if (!ft || ft.roles.length !== 2) return undefined;
    const other = ft.roles.find((r) => r.id !== roleId);
    return other?.objectTypeId ?? undefined;
  });
  const first = candidates[0];
  if (!first || candidates.some((c) => c !== first)) return undefined;
  return model.objectTypes.find((o) => o.id === first)?.name;
}

/* -------------------------------------------------------------------------- */
/* Phrasing helpers                                                            */
/* -------------------------------------------------------------------------- */

function ringPhrase(type: RingType, player: string, factName: string): string {
  switch (type) {
    case 'irreflexive':
      return `no ${player} is related to itself in "${factName}"`;
    case 'reflexive':
      return `each ${player} that plays this fact type is related to itself in "${factName}"`;
    case 'purelyReflexive':
      return `each ${player} in "${factName}" is related only to itself`;
    case 'symmetric':
      return `if one ${player} is related to a second in "${factName}" then the second is related to the first`;
    case 'asymmetric':
      return `if one ${player} is related to a second in "${factName}" then the second is not related to the first`;
    case 'antisymmetric':
      return `if two distinct ${plural(player)} are related in "${factName}" then the reverse does not hold`;
    case 'transitive':
      return `if a first ${player} is related to a second and the second to a third in "${factName}" then the first is related to the third`;
    case 'intransitive':
      return `if a first ${player} is related to a second and the second to a third in "${factName}" then the first is not related to the third`;
    case 'strictlyIntransitive':
      return `"${factName}" is strictly intransitive over ${plural(player)}`;
    case 'acyclic':
      return `no cycle of ${plural(player)} exists in "${factName}"`;
  }
}

function frequencyPhrase(min: number, max: number | null): string {
  if (max === null) return `at least ${min} time${min === 1 ? '' : 's'}`;
  if (min === max) return `exactly ${min} time${min === 1 ? '' : 's'}`;
  return `at least ${min} and at most ${max} times`;
}

function cardinalityPhrase(min: number, max: number | null): string {
  if (max === null) return `at least ${min}`;
  if (min === max) return `exactly ${min}`;
  if (min === 0) return `at most ${max}`;
  return `at least ${min} and at most ${max}`;
}

function formatRanges(ranges: ValueRange[]): string {
  const parts = ranges.map((range) => {
    if (range.value !== undefined) return formatValue(range.value);
    const lower = range.min !== undefined ? formatValue(range.min) : undefined;
    const upper = range.max !== undefined ? formatValue(range.max) : undefined;
    if (lower !== undefined && upper !== undefined) return `${lower}..${upper}`;
    if (lower !== undefined) return `>= ${lower}`;
    if (upper !== undefined) return `<= ${upper}`;
    return '?';
  });
  return `{${parts.join(', ')}}`;
}

function formatValue(value: string | number): string {
  return typeof value === 'number' ? String(value) : `'${value}'`;
}

function modalPrefix(constraint: Constraint, options: VerbalizeOptions): string {
  if (constraint.modality === 'deontic') return 'It is obligatory that ';
  return (options.mode ?? 'forml') === 'forml' ? 'It is necessary that ' : '';
}

function isElementLevel(constraint: Constraint): boolean {
  return (
    (constraint.kind === 'value' || constraint.kind === 'cardinality') && constraint.objectTypeId !== undefined
  );
}

function rolePlayerName(model: OrmModel, roleId: Id): string {
  for (const ft of model.factTypes) {
    const role = ft.roles.find((r) => r.id === roleId);
    if (!role) continue;
    if (!role.objectTypeId) return '(unattached)';
    return model.objectTypes.find((o) => o.id === role.objectTypeId)?.name ?? '(unknown)';
  }
  return '(unknown)';
}

function predicateAfterFirst(ft: FactType, roleId: Id): string {
  const reading: Reading | undefined = readingStartingAt(ft, roleId) ?? primaryReading(ft);
  return reading ? predicateText(reading) : 'plays this role';
}

/** "a", "a and b", "a, b and c". */
function joinList(items: string[], connector: 'and' | 'or'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} ${connector} ${items[items.length - 1]}`;
}

function commaList(items: string[]): string {
  return items.join(', ');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Good-enough English pluralization for verbalized counts. */
export function plural(name: string): string {
  if (/(s|x|z|ch|sh)$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}
