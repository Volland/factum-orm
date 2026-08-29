import {
  Annotated,
  Constraint,
  Diagram,
  FactInstance,
  FactType,
  GraphHints,
  Hints,
  Id,
  LEGACY_SCHEMA_URLS,
  MODEL_FORMAT_VERSION,
  MODEL_SCHEMA_URL,
  Meta,
  ObjectType,
  OrmModel,
  Reading,
  RelationalHints,
  Role,
  Shape,
  SubtypeRelation,
  UniquenessConstraint,
} from './types.js';

let counter = 0;

/** Ids are short, readable and stable enough for a hand-editable JSON file. */
export function newId(prefix: string): Id {
  counter += 1;
  const stamp = Date.now().toString(36).slice(-5);
  return `${prefix}_${stamp}${counter.toString(36)}`;
}

export function emptyModel(name = 'New Model'): OrmModel {
  return {
    $schema: MODEL_SCHEMA_URL,
    version: MODEL_FORMAT_VERSION,
    name,
    objectTypes: [],
    factTypes: [],
    subtypeRelations: [],
    constraints: [],
    diagram: { shapes: {} },
  };
}

/* -------------------------------------------------------------------------- */
/* Indexing                                                                    */
/* -------------------------------------------------------------------------- */

export interface ModelIndex {
  objectTypes: Map<Id, ObjectType>;
  factTypes: Map<Id, FactType>;
  roles: Map<Id, Role>;
  /** Fact type that owns each role. */
  roleOwner: Map<Id, FactType>;
  /** Position of each role inside its fact type. */
  rolePosition: Map<Id, number>;
  constraints: Map<Id, Constraint>;
  subtypeRelations: Map<Id, SubtypeRelation>;
  /** Roles played by each object type. */
  playedRoles: Map<Id, Role[]>;
  /** Constraints touching each role. */
  roleConstraints: Map<Id, Constraint[]>;
}

export function indexModel(model: OrmModel): ModelIndex {
  const index: ModelIndex = {
    objectTypes: new Map(),
    factTypes: new Map(),
    roles: new Map(),
    roleOwner: new Map(),
    rolePosition: new Map(),
    constraints: new Map(),
    subtypeRelations: new Map(),
    playedRoles: new Map(),
    roleConstraints: new Map(),
  };
  for (const ot of model.objectTypes) {
    index.objectTypes.set(ot.id, ot);
    index.playedRoles.set(ot.id, []);
  }
  for (const ft of model.factTypes) {
    index.factTypes.set(ft.id, ft);
    ft.roles.forEach((role, position) => {
      index.roles.set(role.id, role);
      index.roleOwner.set(role.id, ft);
      index.rolePosition.set(role.id, position);
      if (role.objectTypeId) {
        const played = index.playedRoles.get(role.objectTypeId);
        if (played) played.push(role);
      }
    });
  }
  for (const sub of model.subtypeRelations) index.subtypeRelations.set(sub.id, sub);
  for (const constraint of model.constraints) {
    index.constraints.set(constraint.id, constraint);
    for (const roleId of constraintRoles(constraint)) {
      const list = index.roleConstraints.get(roleId);
      if (list) list.push(constraint);
      else index.roleConstraints.set(roleId, [constraint]);
    }
  }
  return index;
}

/** Every role id referenced by a constraint, in declaration order. */
export function constraintRoles(constraint: Constraint): Id[] {
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
    case 'subtypeSet':
      return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

export function factTypeOfRole(model: OrmModel, roleId: Id): FactType | undefined {
  return model.factTypes.find((ft) => ft.roles.some((r) => r.id === roleId));
}

export function findRole(model: OrmModel, roleId: Id): Role | undefined {
  for (const ft of model.factTypes) {
    const role = ft.roles.find((r) => r.id === roleId);
    if (role) return role;
  }
  return undefined;
}

export function arity(factType: FactType): number {
  return factType.roles.length;
}

/** Internal constraints have all their roles inside a single fact type. */
export function isInternal(model: OrmModel, constraint: Constraint): boolean {
  const roles = constraintRoles(constraint);
  if (roles.length === 0) return false;
  const owners = new Set(roles.map((r) => factTypeOfRole(model, r)?.id));
  return owners.size === 1 && !owners.has(undefined);
}

export function primaryReading(factType: FactType): Reading | undefined {
  return factType.readings.find((r) => r.isPrimary) ?? factType.readings[0];
}

/** The reading whose role order starts at `roleId`, used for role verbalization. */
export function readingStartingAt(factType: FactType, roleId: Id): Reading | undefined {
  return factType.readings.find((r) => r.roleOrder[0] === roleId);
}

export function uniquenessConstraintsOf(model: OrmModel, factType: FactType): UniquenessConstraint[] {
  const roleIds = new Set(factType.roles.map((r) => r.id));
  return model.constraints.filter(
    (c): c is UniquenessConstraint =>
      c.kind === 'uniqueness' && c.roles.length > 0 && c.roles.every((r) => roleIds.has(r)),
  );
}

export function isRoleMandatory(model: OrmModel, roleId: Id): boolean {
  return model.constraints.some((c) => c.kind === 'mandatory' && c.roles.length === 1 && c.roles[0] === roleId);
}

/** True when the role is spanned by a single-role uniqueness constraint. */
export function isRoleUnique(model: OrmModel, roleId: Id): boolean {
  return model.constraints.some((c) => c.kind === 'uniqueness' && c.roles.length === 1 && c.roles[0] === roleId);
}

export function preferredIdentifierOf(model: OrmModel, objectTypeId: Id): UniquenessConstraint | undefined {
  return model.constraints.find((c): c is UniquenessConstraint => {
    if (c.kind !== 'uniqueness' || !c.isPreferredIdentifier) return false;
    // The identified object type plays the roles *opposite* the constrained ones.
    return c.roles.some((roleId) => {
      const ft = factTypeOfRole(model, roleId);
      if (!ft) return false;
      return ft.roles.some((r) => r.id !== roleId && r.objectTypeId === objectTypeId);
    });
  });
}

export function supertypesOf(model: OrmModel, objectTypeId: Id): ObjectType[] {
  return model.subtypeRelations
    .filter((s) => s.subtypeId === objectTypeId)
    .map((s) => model.objectTypes.find((o) => o.id === s.supertypeId))
    .filter((o): o is ObjectType => !!o);
}

export function subtypesOf(model: OrmModel, objectTypeId: Id): ObjectType[] {
  return model.subtypeRelations
    .filter((s) => s.supertypeId === objectTypeId)
    .map((s) => model.objectTypes.find((o) => o.id === s.subtypeId))
    .filter((o): o is ObjectType => !!o);
}

/** Walks up the subtype graph; guards against cycles. */
export function allSupertypesOf(model: OrmModel, objectTypeId: Id): ObjectType[] {
  const seen = new Set<Id>([objectTypeId]);
  const out: ObjectType[] = [];
  const queue = [objectTypeId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const parent of supertypesOf(model, current)) {
      if (seen.has(parent.id)) continue;
      seen.add(parent.id);
      out.push(parent);
      queue.push(parent.id);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Naming                                                                      */
/* -------------------------------------------------------------------------- */

/** `Person` or `Person(.nr)` — the standard ORM object type display name. */
export function objectTypeLabel(ot: ObjectType): string {
  const bang = ot.isIndependent ? '!' : '';
  if (ot.kind === 'entity' && ot.refMode) return `${ot.name}${bang}\n(.${ot.refMode})`;
  return `${ot.name}${bang}`;
}

export function objectTypeInlineLabel(ot: ObjectType): string {
  const bang = ot.isIndependent ? '!' : '';
  if (ot.kind === 'entity' && ot.refMode) return `${ot.name}${bang} (.${ot.refMode})`;
  return `${ot.name}${bang}`;
}

/** Expands a reading's placeholders with the supplied per-role text. */
export function expandReading(reading: Reading, roleText: (roleId: Id, position: number) => string): string {
  return reading.text
    .replace(/\{(\d+)\}/g, (match, digits: string) => {
      const position = Number(digits);
      const roleId = reading.roleOrder[position];
      return roleId === undefined ? match : roleText(roleId, position);
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** A reading with placeholders removed, e.g. "works for". */
export function predicateText(reading: Reading): string {
  return reading.text.replace(/\{\d+\}/g, ' ').replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                               */
/* -------------------------------------------------------------------------- */

/** Top-level keys the editor owns; everything else is a caller's extension. */
const KNOWN_MODEL_KEYS = new Set([
  '$schema',
  'version',
  'name',
  'lang',
  'note',
  'meta',
  'hints',
  'generator',
  'objectTypes',
  'factTypes',
  'subtypeRelations',
  'constraints',
  'diagram',
]);

export function serializeModel(model: OrmModel): string {
  // Key order is fixed so that saving a model produces a stable, diffable file.
  const ordered: OrmModel = {
    ...(model.$schema ? { $schema: model.$schema } : {}),
    version: MODEL_FORMAT_VERSION,
    name: model.name,
    ...(model.lang ? { lang: model.lang } : {}),
    ...(model.note ? { note: model.note } : {}),
    ...(model.meta ? { meta: model.meta } : {}),
    ...(model.hints ? { hints: model.hints } : {}),
    ...(model.generator ? { generator: model.generator } : {}),
    objectTypes: model.objectTypes,
    factTypes: model.factTypes,
    subtypeRelations: model.subtypeRelations,
    constraints: model.constraints,
    diagram: model.diagram,
  };
  // Unrecognised top-level keys are written back last, so a document that
  // travelled through another tool loses nothing by being opened here.
  const extras = Object.entries(model as unknown as Record<string, unknown>).filter(
    ([key]) => !KNOWN_MODEL_KEYS.has(key),
  );
  const withExtras = extras.length ? { ...ordered, ...Object.fromEntries(extras) } : ordered;
  return `${JSON.stringify(withExtras, undefined, 2)}\n`;
}

export class ModelParseError extends Error {}

// @lat: [[file-format#Versioning]]
/**
 * Parses and repairs a `.orm.json` document. Missing collections are tolerated
 * so that hand-written files stay easy to start from.
 */
export function parseModel(text: string): OrmModel {
  const trimmed = text.trim();
  if (!trimmed) return emptyModel();
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (error) {
    throw new ModelParseError(`Not valid JSON: ${(error as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ModelParseError('Expected a JSON object at the top level.');
  }
  const source = raw as Partial<OrmModel>;
  const diagram: Diagram = {
    shapes: isRecord(source.diagram?.shapes) ? (source.diagram!.shapes as Record<Id, Shape>) : {},
  };
  if (typeof source.diagram?.name === 'string') diagram.name = source.diagram.name;
  const extras = Object.fromEntries(
    Object.entries(source as Record<string, unknown>).filter(([key]) => !KNOWN_MODEL_KEYS.has(key)),
  );
  const model: OrmModel = {
    ...extras,
    // A version 1 document is a valid version 2 document: version 2 only adds
    // optional `meta`, `hints` and `lang`, so upgrading is a version bump.
    version: MODEL_FORMAT_VERSION,
    name: typeof source.name === 'string' ? source.name : 'Untitled Model',
    objectTypes: asArray(source.objectTypes),
    factTypes: asArray<FactType>(source.factTypes).map((ft) => ({
      ...ft,
      roles: asArray<Role>(ft.roles),
      readings: asArray<Reading>(ft.readings),
    })),
    subtypeRelations: asArray(source.subtypeRelations),
    constraints: asArray(source.constraints),
    diagram,
  };
  if (typeof source.$schema === 'string') {
    // The schema has moved host once. A document naming the old address is
    // still valid — it redirects — but it is upgraded so that every file the
    // editor touches converges on the current URL.
    model.$schema = LEGACY_SCHEMA_URLS.includes(source.$schema) ? MODEL_SCHEMA_URL : source.$schema;
  }
  if (typeof source.lang === 'string') model.lang = source.lang;
  if (typeof source.note === 'string') model.note = source.note;
  if (isRecord(source.meta)) model.meta = source.meta as Meta;
  if (isRecord(source.hints)) model.hints = source.hints as Hints;
  if (isRecord(source.generator) && typeof source.generator.name === 'string') {
    model.generator = source.generator;
  }
  return model;
}

/* -------------------------------------------------------------------------- */
/* Metadata and hints                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Hints for one generation target. Unknown targets are legal, so a caller can
 * read `hintsFor(element, 'ossie')` for a target this editor knows nothing
 * about.
 */
export function hintsFor(element: Annotated | undefined, target: 'relational'): RelationalHints | undefined;
export function hintsFor(element: Annotated | undefined, target: 'graph'): GraphHints | undefined;
export function hintsFor(element: Annotated | undefined, target: string): Record<string, unknown> | undefined;
export function hintsFor(element: Annotated | undefined, target: string): unknown {
  const value = element?.hints?.[target];
  return isRecord(value) ? value : undefined;
}

/**
 * A single string hint, or `undefined` when it is absent or not a string.
 * Hand-edited files are not trusted to have the right types.
 */
export function stringHint(
  element: Annotated | undefined,
  target: string,
  key: string,
): string | undefined {
  const value = (hintsFor(element, target) as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * The best human-readable description of an element: the long description, the
 * short one, then the legacy `note`. Used by generators for comments.
 */
export function describe(element: Annotated & { note?: string }): string | undefined {
  return element.meta?.description ?? element.meta?.shortDescription ?? element.note;
}

/* -------------------------------------------------------------------------- */
/* Populations                                                                 */
/* -------------------------------------------------------------------------- */

/** The sample tuples of a fact type, or an empty list when it has none. */
export function populationOf(factType: FactType): FactInstance[] {
  return Array.isArray(factType.population) ? factType.population : [];
}

/** A tuple's value for one role, or `null` when the role is not covered. */
export function instanceValue(
  factType: FactType,
  instance: FactInstance,
  roleId: Id,
): string | number | boolean | null {
  const position = factType.roles.findIndex((r) => r.id === roleId);
  if (position < 0) return null;
  return instance.values[position] ?? null;
}

/** How many sample tuples the whole model carries. */
export function populationSize(model: OrmModel): number {
  return model.factTypes.reduce((total, ft) => total + populationOf(ft).length, 0);
}

/** Every name an element answers to, for search and for AI context. */
export function synonymsOf(element: Annotated): string[] {
  const fromMeta = element.meta?.synonyms ?? [];
  const fromAi = element.meta?.aiContext?.synonyms ?? [];
  return [...new Set([...fromMeta, ...fromAi].filter((s) => typeof s === 'string' && s.trim()))];
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* -------------------------------------------------------------------------- */
/* Mutation helpers shared by the editor and the commands                      */
/* -------------------------------------------------------------------------- */

export function addObjectType(model: OrmModel, partial: Partial<ObjectType> & { name: string }): ObjectType {
  const ot: ObjectType = {
    id: partial.id ?? newId('ot'),
    name: partial.name,
    kind: partial.kind ?? 'entity',
    refMode: partial.refMode,
    dataType: partial.dataType,
    isIndependent: partial.isIndependent,
    isPersonal: partial.isPersonal,
    objectifiedFactTypeId: partial.objectifiedFactTypeId,
    note: partial.note,
  };
  model.objectTypes.push(ot);
  return ot;
}

export function addFactType(model: OrmModel, roleObjectTypeIds: (Id | null)[], readingText?: string): FactType {
  const roles: Role[] = roleObjectTypeIds.map((objectTypeId) => ({ id: newId('r'), objectTypeId }));
  const text = readingText ?? defaultReadingText(roles.length);
  const factType: FactType = {
    id: newId('ft'),
    roles,
    readings: [{ id: newId('rd'), roleOrder: roles.map((r) => r.id), text, isPrimary: true }],
  };
  model.factTypes.push(factType);
  return factType;
}

export function defaultReadingText(arity: number): string {
  if (arity === 1) return '{0} ...';
  const parts: string[] = ['{0}'];
  for (let i = 1; i < arity; i += 1) parts.push(i === 1 ? '...' : '...', `{${i}}`);
  return parts.join(' ');
}

/** Removes an element and every reference to it, keeping the model consistent. */
export function deleteElement(model: OrmModel, id: Id): void {
  const objectType = model.objectTypes.find((o) => o.id === id);
  if (objectType) {
    model.objectTypes = model.objectTypes.filter((o) => o.id !== id);
    model.subtypeRelations = model.subtypeRelations.filter((s) => s.subtypeId !== id && s.supertypeId !== id);
    for (const ft of model.factTypes) {
      for (const role of ft.roles) if (role.objectTypeId === id) role.objectTypeId = null;
    }
    model.constraints = model.constraints.filter(
      (c) => !(c.kind === 'value' && c.objectTypeId === id) &&
        !(c.kind === 'cardinality' && c.objectTypeId === id) &&
        !(c.kind === 'subtypeSet' && c.supertypeId === id),
    );
    // A fact type objectified by this entity type loses only its objectification.
    for (const other of model.objectTypes) {
      if (other.objectifiedFactTypeId && !model.factTypes.some((f) => f.id === other.objectifiedFactTypeId)) {
        other.objectifiedFactTypeId = undefined;
      }
    }
    delete model.diagram.shapes[id];
    return;
  }

  const factType = model.factTypes.find((f) => f.id === id);
  if (factType) {
    const roleIds = new Set(factType.roles.map((r) => r.id));
    model.factTypes = model.factTypes.filter((f) => f.id !== id);
    model.constraints = model.constraints.filter((c) => !constraintTouchesRoles(c, roleIds));
    for (const ot of model.objectTypes) {
      if (ot.objectifiedFactTypeId === id) ot.objectifiedFactTypeId = undefined;
    }
    delete model.diagram.shapes[id];
    return;
  }

  const subtype = model.subtypeRelations.find((s) => s.id === id);
  if (subtype) {
    model.subtypeRelations = model.subtypeRelations.filter((s) => s.id !== id);
    model.constraints = model.constraints
      .map((c) =>
        c.kind === 'subtypeSet'
          ? { ...c, subtypeRelationIds: c.subtypeRelationIds.filter((rid) => rid !== id) }
          : c,
      )
      .filter((c) => c.kind !== 'subtypeSet' || c.subtypeRelationIds.length > 0);
    delete model.diagram.shapes[id];
    return;
  }

  model.constraints = model.constraints.filter((c) => c.id !== id);
  delete model.diagram.shapes[id];
}

function constraintTouchesRoles(constraint: Constraint, roleIds: Set<Id>): boolean {
  const roles = constraintRoles(constraint);
  return roles.length > 0 && roles.some((r) => roleIds.has(r));
}
