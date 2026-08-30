/**
 * Apache Ossie's ontology specification — the conceptual half of an incubating
 * ASF standard for exchanging semantic metadata.
 *
 * Ossie groups each relationship under the concept that plays its first role,
 * where Factum keeps fact types in a flat list, and states uniqueness as a
 * `multiplicity` keyword rather than as a constraint object. Those two
 * differences are what the converters spend their time on.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  Constraint,
  DataType,
  FactType,
  Id,
  MODEL_SCHEMA_URL,
  ObjectType,
  OrmModel,
  Reading,
  Role,
  ValueRange,
} from '../model/types.js';
import {
  emptyModel,
  indexModel,
  newId,
  predicateText,
  primaryReading,
} from '../model/model.js';
import {
  dataTypeToPortable,
  ExportResult,
  ImportResult,
  snakeCase,
  uniqueName,
} from './interop.js';

/** The specification revision these converters target. */
const OSSIE_VERSION = '0.2.0.dev0';

/** Concepts every ontology may refer to without declaring them. */
const BUILT_IN: Record<string, DataType | undefined> = {
  Any: undefined,
  Boolean: 'boolean',
  Date: 'date',
  DateTime: 'dateTime',
  Decimal: 'decimal',
  Float: 'float',
  Integer: 'integer',
  String: 'string',
};

interface OssieRole {
  concept?: string;
  name?: string;
}

interface OssieRelationship {
  name?: string;
  description?: string;
  multiplicity?: string;
  roles?: OssieRole[];
  derived_by?: string[];
  requires?: string[];
  verbalizes?: string[];
}

/**
 * The flat shape the rest of this file works in: a concept named by a string,
 * with its attributes and its relationships beside it.
 */
interface OssieConcept {
  concept?: string;
  type?: string;
  description?: string;
  extends?: string[];
  derived_by?: string[];
  identify_by?: string[];
  requires?: string[];
  relationships?: OssieRelationship[];
}

/** A concept's attributes when an entry nests them rather than inlining them. */
interface OssieConceptBlock {
  name?: string;
  type?: string;
  description?: string;
  extends?: string[];
  derived_by?: string[];
  identify_by?: string[];
  requires?: string[];
}

/**
 * An ontology entry as it is actually written. The specification's own examples
 * put the concept name and its attributes directly on the entry; FactEngine
 * nests them under a `concept` block and leaves `relationships` outside it.
 * Both forms are in the wild, so `normalizeEntry` reads either.
 */
interface OssieEntry extends Omit<OssieConcept, 'concept'> {
  concept?: string | OssieConceptBlock;
}

interface OssieDocument {
  /** YAML reads an unquoted `1.0` as a number, so this is not always a string. */
  version?: string | number;
  name?: string;
  description?: string;
  requires?: string[];
  ontology?: OssieEntry[];
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

export function importOssieFile(text: string): ImportResult {
  const parsed = parseYaml(text) as OssieDocument | undefined;
  const entries = parsed?.ontology;
  if (!parsed || !Array.isArray(entries)) {
    throw new Error('Not an Ossie ontology: no top-level `ontology` list was found.');
  }

  const warnings: string[] = [];
  // Both entry forms are flattened up front so nothing below has to know which
  // one this document used.
  const ontology: OssieConcept[] = [];
  entries.forEach((entry, index) => {
    const concept = normalizeEntry(entry);
    if (concept) ontology.push(concept);
    else warnings.push(`Ontology entry ${index + 1} names no concept and was skipped.`);
  });

  const model = emptyModel(nonEmptyString(parsed.name) ?? 'Imported Ontology');
  model.$schema = MODEL_SCHEMA_URL;
  model.generator = { name: 'Factum Ossie importer' };
  const description = nonEmptyString(parsed.description);
  model.meta = {
    ...(description ? { description } : {}),
    source: {
      tool: 'Apache Ossie',
      // A YAML `version: 1.0` arrives as a number; the model schema wants text.
      ...(parsed.version != null ? { version: String(parsed.version) } : {}),
    },
  };

  // Concepts first, so relationships can resolve their role players by name.
  const byName = new Map<string, ObjectType>();
  for (const concept of ontology) {
    const name = concept.concept;
    if (!name) continue;
    const kind = concept.type === 'ValueType' ? 'value' : 'entity';
    const ot: ObjectType = {
      id: newId(kind === 'value' ? 'vt' : 'ot'),
      name,
      kind,
      ...(kind === 'value' ? { dataType: builtInDataType(concept, ontology) } : {}),
    };
    if (concept.description) ot.meta = { description: concept.description };
    if (concept.derived_by?.length) {
      ot.note = `Derived by: ${concept.derived_by.join('; ')}`;
    }
    byName.set(name, ot);
    model.objectTypes.push(ot);
  }

  // Built-in concepts are only materialised when something actually plays them.
  const builtInUsed = new Map<string, ObjectType>();
  const resolve = (name: string | undefined): ObjectType | undefined => {
    if (!name) return undefined;
    const declared = byName.get(name);
    if (declared) return declared;
    if (!(name in BUILT_IN)) return undefined;
    const existing = builtInUsed.get(name);
    if (existing) return existing;
    const ot: ObjectType = { id: newId('vt'), name, kind: 'value', dataType: BUILT_IN[name] };
    builtInUsed.set(name, ot);
    model.objectTypes.push(ot);
    return ot;
  };

  for (const concept of ontology) {
    const host = concept.concept ? byName.get(concept.concept) : undefined;
    if (!host) continue;

    // `extends` naming a declared concept is subtyping; naming a built-in it
    // only supplies the data type, which was resolved when the concept was made.
    for (const parent of concept.extends ?? []) {
      // Extending a built-in only supplies the data type; it is not subtyping.
      if (parent in BUILT_IN) continue;
      const supertype = byName.get(parent);
      if (supertype) {
        model.subtypeRelations.push({ id: newId('st'), subtypeId: host.id, supertypeId: supertype.id });
      }
    }
    for (const expression of concept.requires ?? []) {
      const ranges = rangesFromExpression(expression, host.name);
      if (ranges.length) {
        model.constraints.push({ kind: 'value', id: newId('vc'), objectTypeId: host.id, ranges });
      } else {
        host.note = host.note ? `${host.note}\n${expression}` : `Requires: ${expression}`;
      }
    }

    const declared = new Set((concept.relationships ?? []).map((r) => r.name).filter(Boolean));
    for (const relationship of concept.relationships ?? []) {
      const factType = importRelationship(concept, host, relationship, resolve, model, warnings);
      if (!factType) continue;
      const identifying = (concept.identify_by ?? []).includes(relationship.name ?? '');
      applyMultiplicity(model, factType, relationship, identifying, host, warnings);
    }
    // `identify_by` may name a relationship declared on another concept, which
    // is external identification. ORM states that as an external uniqueness
    // constraint over the roles opposite this type; nothing here builds one.
    for (const name of concept.identify_by ?? []) {
      if (declared.has(name)) continue;
      warnings.push(
        `"${host.name}" is identified by "${name}", which is declared on another concept; that external identification was not carried.`,
      );
    }
  }

  if (parsed.requires?.length) {
    model.note = `Ontology requires: ${parsed.requires.join('; ')}`;
  }
  return { model, warnings };
}

/**
 * Reads an ontology entry into the flat shape the importer works in, whether it
 * inlined its concept (`concept: Person`) or nested it (`concept: {name:
 * Person}`). An entry that names nothing is rejected rather than imported under
 * an object for a name, which is what produced unusable models before.
 */
function normalizeEntry(entry: OssieEntry | undefined): OssieConcept | undefined {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  const nested = isConceptBlock(entry.concept) ? entry.concept : undefined;
  const own = entry as OssieConceptBlock;
  const name = nonEmptyString(nested ? nested.name : entry.concept);
  if (!name) return undefined;
  return {
    concept: name,
    type: nonEmptyString(nested?.type) ?? nonEmptyString(own.type),
    description: nonEmptyString(nested?.description) ?? nonEmptyString(own.description),
    extends: stringList(nested?.extends) ?? stringList(own.extends),
    derived_by: stringList(nested?.derived_by) ?? stringList(own.derived_by),
    identify_by: stringList(nested?.identify_by) ?? stringList(own.identify_by),
    requires: stringList(nested?.requires) ?? stringList(own.requires),
    relationships: Array.isArray(entry.relationships) ? entry.relationships : undefined,
  };
}

function isConceptBlock(value: unknown): value is OssieConceptBlock {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An empty YAML key reads as null, and a single value need not be a list. */
function stringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return value ? [value] : undefined;
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return items.length ? items : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function importRelationship(
  concept: OssieConcept,
  host: ObjectType,
  relationship: OssieRelationship,
  resolve: (name: string | undefined) => ObjectType | undefined,
  model: OrmModel,
  warnings: string[],
): FactType | undefined {
  const name = relationship.name;
  if (!name) {
    warnings.push(`A relationship on "${host.name}" has no name and was skipped.`);
    return undefined;
  }

  // By convention the first role is played by the containing concept.
  const roles: Role[] = [{ id: newId('r'), objectTypeId: host.id }];
  for (const role of relationship.roles ?? []) {
    const player = resolve(role.concept);
    if (!player) {
      warnings.push(
        `Relationship "${concept.concept}.${name}" refers to undeclared concept "${role.concept}"; the role was left unattached.`,
      );
    }
    roles.push({
      id: newId('r'),
      objectTypeId: player?.id ?? null,
      ...(role.name ? { name: role.name } : {}),
    });
  }

  const playerNames = roles.map((r) => model.objectTypes.find((o) => o.id === r.objectTypeId)?.name);
  const roleNames = roles.map((r) => r.name);
  const readings: Reading[] = [];
  for (const pattern of relationship.verbalizes ?? []) {
    const text = readingFromVerbalization(pattern, playerNames, roleNames);
    if (text) {
      readings.push({
        id: newId('rd'),
        roleOrder: roles.map((r) => r.id),
        text,
        isPrimary: readings.length === 0 || undefined,
      });
    }
  }
  if (!readings.length) {
    // A relationship with no `verbalizes` still has a usable name.
    readings.push({
      id: newId('rd'),
      roleOrder: roles.map((r) => r.id),
      text: `{0} ${name.replace(/_/g, ' ')}${roles.length > 1 ? ` ${roles.slice(1).map((_, i) => `{${i + 1}}`).join(' ')}` : ''}`,
      isPrimary: true,
    });
  }

  const factType: FactType = {
    id: newId('ft'),
    roles,
    readings,
    ...(relationship.derived_by?.length
      ? { isDerived: true, derivationRule: relationship.derived_by.join('\n') }
      : {}),
  };
  if (relationship.description) factType.meta = { description: relationship.description };
  for (const expression of relationship.requires ?? []) {
    factType.note = factType.note ? `${factType.note}\n${expression}` : `Requires: ${expression}`;
  }
  model.factTypes.push(factType);
  return factType;
}

/**
 * `ManyToOne` says the last role is functionally determined by the others, which
 * is a uniqueness constraint over every role but the last. `OneToOne` adds the
 * same in the other direction.
 *
 * A preferred identifier belongs on the constraint over the roles *opposite* the
 * concept being identified — "each PersonNr identifies at most one Person" —
 * which is where the rest of the model looks for it. That only exists when the
 * relationship is a one-to-one binary, so anything else `identify_by` names is
 * reported rather than marked in the wrong place.
 */
function applyMultiplicity(
  model: OrmModel,
  factType: FactType,
  relationship: OssieRelationship,
  identifying: boolean,
  host: ObjectType,
  warnings: string[],
): void {
  const roles = factType.roles;
  const multiplicity = relationship.multiplicity;
  if (roles.length < 2 || !multiplicity) {
    if (identifying) {
      warnings.push(
        `"${host.name}" is identified by "${relationship.name}", which states no multiplicity; the preferred identifier was not carried.`,
      );
    }
    return;
  }
  const identifies = identifying && multiplicity === 'OneToOne' && roles.length === 2;
  if (identifying && !identifies) {
    warnings.push(
      `"${host.name}" is identified by "${relationship.name}", which is not a one-to-one binary; the preferred identifier was not carried.`,
    );
  }
  model.constraints.push({ kind: 'uniqueness', id: newId('uc'), roles: roles.slice(0, -1).map((r) => r.id) });
  if (multiplicity === 'OneToOne' && roles.length === 2) {
    model.constraints.push({
      kind: 'uniqueness',
      id: newId('uc'),
      roles: [roles[1].id],
      ...(identifies ? { isPreferredIdentifier: true } : {}),
    });
  }
}

/**
 * A value type's data type is the built-in at the end of its `extends` chain:
 * `Capacity extends NrPounds extends Integer` is an integer.
 */
function builtInDataType(
  concept: OssieConcept,
  ontology: OssieConcept[],
  seen = new Set<string>(),
): DataType | undefined {
  if (concept.concept) {
    if (seen.has(concept.concept)) return undefined; // guards a cyclic `extends`
    seen.add(concept.concept);
  }
  for (const name of concept.extends ?? []) {
    if (name in BUILT_IN) return BUILT_IN[name];
    const parent = ontology.find((c) => c.concept === name);
    if (parent) {
      const resolved = builtInDataType(parent, ontology, seen);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

/**
 * Turns `{Person} works for {Company}` into `{0} works for {1}` by matching each
 * placeholder to the first role not yet used whose player — or role name —
 * carries that name.
 */
function readingFromVerbalization(
  pattern: string,
  playerNames: (string | undefined)[],
  roleNames: (string | undefined)[],
): string | undefined {
  const used = new Set<number>();
  let matched = 0;
  const text = pattern.replace(/\{([^}]+)\}/g, (match, body: string) => {
    const [concept, roleName] = body.split(':').map((s) => s.trim());
    const position = playerNames.findIndex(
      (player, i) =>
        !used.has(i) && player === concept && (!roleName || roleNames[i] === roleName),
    );
    if (position < 0) return match;
    used.add(position);
    matched += 1;
    return `{${position}}`;
  });
  return matched ? text.replace(/\s+/g, ' ').trim() : undefined;
}

/** Recognises the two `requires` shapes that map onto an ORM value constraint. */
function rangesFromExpression(expression: string, concept: string): ValueRange[] {
  const escaped = concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const equality = new RegExp(`${escaped}\\s*==\\s*('[^']*'|"[^"]*"|[-\\d.]+)`, 'g');
  const values: ValueRange[] = [];
  for (const match of expression.matchAll(equality)) {
    values.push({ value: unquote(match[1]) });
  }
  if (values.length) return values;

  const bound = new RegExp(
    `(?:${escaped}\\s*(<=|>=|<|>)\\s*([-\\d.]+))|(?:([-\\d.]+)\\s*(<=|>=|<|>)\\s*${escaped})`,
  );
  const match = bound.exec(expression);
  if (!match) return [];
  const [, opAfter, valueAfter, valueBefore, opBefore] = match;
  if (opAfter && valueAfter !== undefined) {
    const inclusive = opAfter.includes('=');
    return opAfter.startsWith('<')
      ? [{ max: Number(valueAfter), maxInclusive: inclusive }]
      : [{ min: Number(valueAfter), minInclusive: inclusive }];
  }
  if (opBefore && valueBefore !== undefined) {
    const inclusive = opBefore.includes('=');
    // `0 < X` bounds X from below.
    return opBefore.startsWith('<')
      ? [{ min: Number(valueBefore), minInclusive: inclusive }]
      : [{ max: Number(valueBefore), maxInclusive: inclusive }];
  }
  return [];
}

function unquote(value: string): string | number {
  const text = value.replace(/^['"]|['"]$/g, '');
  const asNumber = Number(text);
  return value.startsWith("'") || value.startsWith('"') || !Number.isFinite(asNumber) ? text : asNumber;
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

export function exportOssieFile(model: OrmModel): ExportResult {
  const warnings: string[] = [];
  const index = indexModel(model);
  const used = new Set<string>();

  const conceptNames = new Map<Id, string>();
  for (const ot of model.objectTypes) {
    conceptNames.set(ot.id, uniqueName(used, ot.name.replace(/[^A-Za-z0-9_]/g, '') || 'Concept'));
  }

  // Every fact type is hosted by the concept playing the first role of its
  // primary reading, which is the shape Ossie's `ontology` list takes.
  const hosted = new Map<Id, { factType: FactType; order: Id[] }[]>();
  for (const ft of model.factTypes) {
    const reading = primaryReading(ft);
    const order = reading?.roleOrder.length === ft.roles.length ? reading.roleOrder : ft.roles.map((r) => r.id);
    const hostRole = ft.roles.find((r) => r.id === order[0]);
    if (!hostRole?.objectTypeId) {
      warnings.push(
        `Fact type "${reading ? predicateText(reading) : ft.id}" has no player on its first role and was dropped.`,
      );
      continue;
    }
    const bucket = hosted.get(hostRole.objectTypeId) ?? [];
    bucket.push({ factType: ft, order });
    hosted.set(hostRole.objectTypeId, bucket);
  }

  const ontology: OssieConcept[] = [];
  for (const ot of model.objectTypes) {
    // Every ontology implicitly includes the built-in concepts, so a value type
    // that is merely one of them is left out rather than redeclared.
    if (ot.kind === 'value' && ot.name in BUILT_IN && !(hosted.get(ot.id) ?? []).length) continue;
    if (ot.objectifiedFactTypeId) {
      warnings.push(
        `"${ot.name}" objectifies a fact type. Ossie has no objectification, so it was written as a plain entity type.`,
      );
    }
    const concept: OssieConcept = {
      concept: conceptNames.get(ot.id)!,
      type: ot.kind === 'value' ? 'ValueType' : 'EntityType',
    };
    const description = ot.meta?.description ?? ot.meta?.shortDescription ?? ot.note;
    if (description) concept.description = description;

    const supertypes = model.subtypeRelations
      .filter((s) => s.subtypeId === ot.id)
      .map((s) => conceptNames.get(s.supertypeId))
      .filter((n): n is string => !!n);
    if (supertypes.length) {
      concept.extends = supertypes;
    } else if (ot.kind === 'value') {
      // A value type with no supertype must still extend a built-in, which is
      // where Ossie keeps its data type.
      concept.extends = [dataTypeToPortable(ot.dataType)];
    }

    const requires = valueConstraintExpressions(model, ot, concept.concept!);
    if (requires.length) concept.requires = requires;

    const relationships: OssieRelationship[] = [];
    const relationshipNames = new Set<string>();
    const identifying: string[] = [];
    for (const { factType, order } of hosted.get(ot.id) ?? []) {
      const built = relationshipOf(factType, order, model, index, conceptNames, relationshipNames);
      if (!built) continue;
      relationships.push(built.relationship);
      if (built.isPreferredIdentifier) identifying.push(built.relationship.name!);
    }
    if (identifying.length) concept.identify_by = identifying;
    if (relationships.length) concept.relationships = relationships;
    ontology.push(concept);
  }

  const document: OssieDocument = {
    version: OSSIE_VERSION,
    name: model.name,
    ...(model.meta?.description ? { description: model.meta.description } : {}),
    ontology,
  };
  return { text: stringifyYaml(document, { lineWidth: 100 }), warnings };
}

function relationshipOf(
  ft: FactType,
  order: Id[],
  model: OrmModel,
  index: ReturnType<typeof indexModel>,
  conceptNames: Map<Id, string>,
  used: Set<string>,
): { relationship: OssieRelationship; isPreferredIdentifier: boolean } | undefined {
  const ordered = order
    .map((roleId) => ft.roles.find((r) => r.id === roleId))
    .filter((r): r is Role => !!r);
  if (!ordered.length) return undefined;
  const reading = primaryReading(ft);

  const relationship: OssieRelationship = {
    name: uniqueName(used, snakeCase(reading ? predicateText(reading) : 'relates to')),
  };
  const description = ft.meta?.description ?? ft.meta?.shortDescription ?? ft.note;
  if (description) relationship.description = description;

  if (ordered.length > 1) {
    relationship.roles = ordered.slice(1).map((role) => ({
      concept: role.objectTypeId ? conceptNames.get(role.objectTypeId) ?? 'Any' : 'Any',
      ...(role.name ? { name: role.name } : {}),
    }));
  }

  // Uniqueness over every role but the last is exactly Ossie's ManyToOne.
  const leading = ordered.slice(0, -1).map((r) => r.id);
  const spanning = model.constraints.find(
    (c): c is Extract<Constraint, { kind: 'uniqueness' }> =>
      c.kind === 'uniqueness' &&
      c.roles.length === leading.length &&
      leading.every((id) => c.roles.includes(id)),
  );
  const trailingUnique =
    ordered.length === 2 &&
    model.constraints.some(
      (c) => c.kind === 'uniqueness' && c.roles.length === 1 && c.roles[0] === ordered[1].id,
    );
  if (spanning) relationship.multiplicity = trailingUnique ? 'OneToOne' : 'ManyToOne';

  if (reading) {
    relationship.verbalizes = ft.readings
      .map((r) => verbalizationOf(r, ft, conceptNames, model))
      .filter((v): v is string => !!v);
  }
  if (ft.isDerived && ft.derivationRule) relationship.derived_by = ft.derivationRule.split('\n');

  void index;
  return { relationship, isPreferredIdentifier: !!spanning?.isPreferredIdentifier };
}

/** `{0} works for {1}` becomes `{Person} works for {Company}`. */
function verbalizationOf(
  reading: Reading,
  ft: FactType,
  conceptNames: Map<Id, string>,
  model: OrmModel,
): string | undefined {
  const counts = new Map<string, number>();
  for (const role of ft.roles) {
    const name = role.objectTypeId ? conceptNames.get(role.objectTypeId) : undefined;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  void model;
  return reading.text.replace(/\{(\d+)\}/g, (match, digits: string) => {
    const roleId = reading.roleOrder[Number(digits)];
    const role = ft.roles.find((r) => r.id === roleId);
    const concept = role?.objectTypeId ? conceptNames.get(role.objectTypeId) : undefined;
    if (!concept) return match;
    // A concept playing several roles needs the role name to stay unambiguous.
    return (counts.get(concept) ?? 0) > 1 && role?.name ? `{${concept}:${role.name}}` : `{${concept}}`;
  });
}

/**
 * One `requires` entry per constraint, so a concept carrying several — an upper
 * and a lower bound, say — keeps them separate through a round trip.
 */
function valueConstraintExpressions(model: OrmModel, ot: ObjectType, concept: string): string[] {
  const constraints = model.constraints.filter(
    (c): c is Extract<Constraint, { kind: 'value' }> => c.kind === 'value' && c.objectTypeId === ot.id,
  );
  const out: string[] = [];
  for (const constraint of constraints) {
    const discrete = constraint.ranges.filter((r) => r.value !== undefined);
    if (discrete.length) {
      out.push(discrete.map((r) => `${concept} == ${literal(r.value!)}`).join(' OR '));
      continue;
    }
    for (const range of constraint.ranges) {
      if (range.min !== undefined) out.push(`${concept} >${range.minInclusive === false ? '' : '='} ${literal(range.min)}`);
      if (range.max !== undefined) out.push(`${concept} <${range.maxInclusive === false ? '' : '='} ${literal(range.max)}`);
    }
  }
  return out;
}

function literal(value: string | number): string {
  return typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`;
}
