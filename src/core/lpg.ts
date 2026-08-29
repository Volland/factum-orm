import { DataType, FactType, Id, ObjectType, OrmModel, Role, ValueRange } from '../model/types.js';
import { indexModel, ModelIndex, predicateText, primaryReading } from '../model/model.js';
import { factTypeName, verbalizeConstraint } from './verbalize.js';

/* -------------------------------------------------------------------------- */
/* Labeled property graph schema                                               */
/* -------------------------------------------------------------------------- */

/** How a relationship's endpoints are constrained, in LadybugDB's vocabulary. */
export type Multiplicity = 'ONE_ONE' | 'ONE_MANY' | 'MANY_ONE' | 'MANY_MANY';

export interface GraphProperty {
  name: string;
  dataType: DataType;
  length?: number;
  scale?: number;
  isPrimaryKey?: boolean;
  /** Backed by a mandatory role; the graph schema cannot enforce it. */
  isRequired?: boolean;
  /** Allowed values from a value constraint, kept for documentation. */
  allowedValues?: ValueRange[];
  sourceRoleId?: Id;
  sourceObjectTypeId?: Id;
  comment?: string;
}

export interface NodeTable {
  name: string;
  sourceKind: 'objectType' | 'factType';
  sourceId: Id;
  /** True when the node stands for a fact rather than an object (reification). */
  isReified: boolean;
  properties: GraphProperty[];
  comment?: string;
}

/** One `FROM ... TO ...` pair of a relationship table. */
export interface RelEndpoints {
  from: string;
  to: string;
}

export interface RelTable {
  name: string;
  /** Model elements this table came from; role links merge several. */
  sources: { kind: 'factType' | 'subtype'; id: Id }[];
  pairs: RelEndpoints[];
  multiplicity: Multiplicity;
  properties: GraphProperty[];
  comment?: string;
}

/** A constraint the property-graph schema cannot express, kept as documentation. */
export interface UnenforcedConstraint {
  constraintId: Id;
  kind: string;
  text: string;
}

export interface GraphSchema {
  name: string;
  nodeTables: NodeTable[];
  relTables: RelTable[];
  notes: string[];
  unenforced: UnenforcedConstraint[];
}

export interface GraphMapOptions {
  /**
   * `nodeTable` gives each subtype its own label joined by `IS_A`; `absorb`
   * folds subtypes into their supertype with optional properties.
   */
  subtypeStrategy?: 'nodeTable' | 'absorb';
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                     */
/* -------------------------------------------------------------------------- */

interface GraphContext {
  model: OrmModel;
  index: ModelIndex;
  strategy: 'nodeTable' | 'absorb';
  /** Object type id -> object type it is absorbed into. */
  absorbedInto: Map<Id, Id>;
  /** Value types that could not be absorbed as properties and became nodes. */
  promoted: Set<Id>;
  /** Constraints the generated schema genuinely enforces; the rest are documented. */
  enforced: Set<Id>;
  /** Node tables keyed by object type id, or by fact type id when reified. */
  nodes: Map<Id, NodeTable>;
  rels: RelTable[];
  notes: string[];
  unenforced: UnenforcedConstraint[];
  usedNodeNames: Set<string>;
  usedRelNames: Set<string>;
  /** Role-link tables keyed by target node, so they can take extra pairs. */
  roleLinks: Map<string, RelTable>;
}

/**
 * Maps a conceptual schema to a labeled property graph.
 *
 * The shape of the result follows from ORM itself: an entity type is a node,
 * a value type is a property of the object it describes (unless it is played
 * many-to-many, when it has to become a node of its own), a binary fact type
 * is an edge whose multiplicity is read straight off its uniqueness
 * constraints, and any fact type an edge cannot carry — n-ary, or objectified —
 * is reified into a node linked to each role player, which is the Levi
 * (bipartite) form of the hyperedge the fact type really is.
 */
export function mapToGraph(model: OrmModel, options: GraphMapOptions = {}): GraphSchema {
  const context: GraphContext = {
    model,
    index: indexModel(model),
    strategy: options.subtypeStrategy ?? 'nodeTable',
    absorbedInto: new Map(),
    promoted: new Set(),
    enforced: new Set(),
    nodes: new Map(),
    rels: [],
    notes: [],
    unenforced: [],
    usedNodeNames: new Set(),
    usedRelNames: new Set(),
    roleLinks: new Map(),
  };

  planSubtypes(context);
  planValueTypes(context);
  createEntityNodes(context);
  createReifiedNodes(context);
  mapFactTypes(context);
  createSubtypeRels(context);
  collectUnenforced(context);

  return {
    name: model.name,
    nodeTables: [...context.nodes.values()],
    relTables: context.rels,
    notes: context.notes,
    unenforced: context.unenforced,
  };
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                    */
/* -------------------------------------------------------------------------- */

function planSubtypes(context: GraphContext): void {
  if (context.strategy !== 'absorb') return;
  for (const ot of context.model.objectTypes) {
    const root = rootSupertype(context, ot.id);
    if (root === ot.id) continue;
    context.absorbedInto.set(ot.id, root);
    const rootName = context.index.objectTypes.get(root)?.name ?? root;
    context.notes.push(`"${ot.name}" is absorbed into "${rootName}"; its properties are optional there.`);
  }
}

function rootSupertype(context: GraphContext, objectTypeId: Id): Id {
  const seen = new Set<Id>([objectTypeId]);
  let current = objectTypeId;
  for (;;) {
    const relations = context.model.subtypeRelations.filter((s) => s.subtypeId === current);
    if (!relations.length) return current;
    const preferred = relations.find((s) => s.isPreferredIdentificationPath) ?? relations[0];
    if (seen.has(preferred.supertypeId)) return current;
    seen.add(preferred.supertypeId);
    current = preferred.supertypeId;
  }
}

/**
 * A value type stays a property only while every role it plays is
 * single-valued for the object that plays the opposite role. One many-to-many
 * or n-ary role and it has to become a node, or the property would have to
 * hold a set.
 */
function planValueTypes(context: GraphContext): void {
  for (const ot of context.model.objectTypes) {
    if (ot.kind !== 'value') continue;
    const roles = context.index.playedRoles.get(ot.id) ?? [];
    if (!roles.length) {
      // Nothing refers to it; keep it out of the schema rather than emit an empty node.
      continue;
    }
    const absorbable = roles.every((role) => absorbableAsProperty(context, role));
    if (!absorbable) {
      context.promoted.add(ot.id);
      context.notes.push(
        `Value type "${ot.name}" became a node because it is played many-to-many or in an n-ary fact type; it cannot be a single-valued property.`,
      );
    }
  }
}

/** True when this value-type role can be folded into the opposite node. */
function absorbableAsProperty(context: GraphContext, role: Role): boolean {
  const ft = context.index.roleOwner.get(role.id);
  if (!ft || ft.roles.length !== 2) return false;
  if (isObjectified(context, ft)) return false;
  const opposite = ft.roles.find((r) => r.id !== role.id);
  if (!opposite?.objectTypeId) return false;
  const oppositePlayer = context.index.objectTypes.get(opposite.objectTypeId);
  if (!oppositePlayer || oppositePlayer.kind !== 'entity') return false;
  // The opposite role must be uniquely constrained: one entity, at most one value.
  return hasSingleRoleUniqueness(context, opposite.id);
}

function createEntityNodes(context: GraphContext): void {
  for (const ot of context.model.objectTypes) {
    const isPromotedValue = ot.kind === 'value' && context.promoted.has(ot.id);
    if (ot.kind === 'value' && !isPromotedValue) continue;
    if (context.absorbedInto.has(ot.id)) continue;
    if (ot.objectifiedFactTypeId) continue; // created as a reified node instead

    const table: NodeTable = {
      name: uniqueNodeName(context, nodeLabel(ot.name)),
      sourceKind: 'objectType',
      sourceId: ot.id,
      isReified: false,
      properties: [identityProperty(context, ot)],
      comment: `${ot.kind === 'value' ? 'Value' : 'Entity'} type ${ot.name}`,
    };
    context.nodes.set(ot.id, table);
  }
}

/**
 * The primary key LadybugDB requires. A reference mode gives it directly; an
 * explicit single-role preferred identifier over a value type works too;
 * anything else gets a generated key, with a note saying so.
 */
function identityProperty(context: GraphContext, ot: ObjectType): GraphProperty {
  if (ot.kind === 'value') {
    return {
      name: propertyName(ot.name),
      dataType: ot.dataType ?? 'string',
      length: ot.dataTypeLength,
      scale: ot.dataTypeScale,
      isPrimaryKey: true,
      isRequired: true,
      sourceObjectTypeId: ot.id,
      comment: 'Lexical value; identifies itself',
    };
  }

  if (ot.refMode) {
    return {
      name: propertyName(ot.refMode),
      dataType: ot.dataType ?? refModeDataType(ot.refMode),
      length: ot.dataTypeLength,
      scale: ot.dataTypeScale,
      isPrimaryKey: true,
      isRequired: true,
      sourceObjectTypeId: ot.id,
      comment: `Reference mode ${ot.name}(.${ot.refMode})`,
    };
  }

  // A subtype with its own label reuses the identifier it inherits.
  const inherited = inheritedIdentity(context, ot);
  if (inherited) return inherited;

  const preferred = preferredIdentifierRoles(context, ot);
  if (preferred.length === 1) {
    const role = context.index.roles.get(preferred[0]);
    const player = role?.objectTypeId ? context.index.objectTypes.get(role.objectTypeId) : undefined;
    if (player && player.kind === 'value' && !context.promoted.has(player.id)) {
      markEnforced(context, preferred[0]);
      return {
        name: propertyName(role?.name ?? player.name),
        dataType: player.dataType ?? 'string',
        length: player.dataTypeLength,
        scale: player.dataTypeScale,
        isPrimaryKey: true,
        isRequired: true,
        sourceRoleId: role?.id,
        sourceObjectTypeId: player.id,
        comment: `Preferred identifier of ${ot.name}`,
      };
    }
  }
  if (preferred.length > 1) {
    context.notes.push(
      `"${ot.name}" has a compound preferred identifier. LadybugDB primary keys are single-column, so a generated "id" key was used and the identifying combination is listed under the unenforced constraints.`,
    );
  } else {
    context.notes.push(`"${ot.name}" has no reference scheme; a generated "id" key was added.`);
  }
  return {
    name: 'id',
    dataType: 'autoCounter',
    isPrimaryKey: true,
    isRequired: true,
    sourceObjectTypeId: ot.id,
    comment: 'Generated key',
  };
}

function inheritedIdentity(context: GraphContext, ot: ObjectType): GraphProperty | undefined {
  if (context.strategy !== 'nodeTable') return undefined;
  const relations = context.model.subtypeRelations.filter((s) => s.subtypeId === ot.id);
  if (!relations.length) return undefined;
  const preferred = relations.find((s) => s.isPreferredIdentificationPath) ?? relations[0];
  const supertype = context.index.objectTypes.get(preferred.supertypeId);
  if (!supertype || supertype.id === ot.id) return undefined;
  const property = identityProperty(context, supertype);
  return {
    ...property,
    sourceObjectTypeId: ot.id,
    comment: `Inherited identifier from ${supertype.name}`,
  };
}

function preferredIdentifierRoles(context: GraphContext, ot: ObjectType): Id[] {
  const constraint = context.model.constraints.find(
    (c) =>
      c.kind === 'uniqueness' &&
      c.isPreferredIdentifier &&
      c.roles.some((roleId) => {
        const ft = context.index.roleOwner.get(roleId);
        return !!ft && ft.roles.some((r) => r.id !== roleId && r.objectTypeId === ot.id);
      }),
  );
  return constraint && constraint.kind === 'uniqueness' ? constraint.roles : [];
}

/** Objectified and n-ary fact types become nodes: an edge cannot hold them. */
function createReifiedNodes(context: GraphContext): void {
  for (const ft of context.model.factTypes) {
    const objectifier = context.model.objectTypes.find((o) => o.objectifiedFactTypeId === ft.id);
    const isNary = ft.roles.length > 2;
    if (!objectifier && !isNary) continue;

    const label = objectifier ? nodeLabel(objectifier.name) : nodeLabel(factLabel(context, ft));
    const table: NodeTable = {
      name: uniqueNodeName(context, label),
      sourceKind: 'factType',
      sourceId: ft.id,
      isReified: true,
      properties: [
        {
          name: 'id',
          dataType: 'autoCounter',
          isPrimaryKey: true,
          isRequired: true,
          comment: 'Generated key for the reified fact',
        },
      ],
      comment: objectifier
        ? `Objectified fact type "${readingLabel(context, ft)}" (${objectifier.name})`
        : `Reified ${ft.roles.length}-ary fact type "${readingLabel(context, ft)}"`,
    };
    context.nodes.set(objectifier ? objectifier.id : ft.id, table);
    if (isNary && !objectifier) {
      context.notes.push(
        `"${readingLabel(context, ft)}" is ${ft.roles.length}-ary. A property-graph edge joins exactly two nodes, so the fact type was reified into the "${table.name}" node with one relationship per role. Objectify the fact type to give that node a name of your own.`,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Fact types                                                                  */
/* -------------------------------------------------------------------------- */

function mapFactTypes(context: GraphContext): void {
  for (const ft of context.model.factTypes) {
    const reified = reifiedNodeOf(context, ft);
    if (reified) {
      mapReifiedRoles(context, ft, reified);
      continue;
    }
    if (ft.roles.length === 1) {
      mapUnary(context, ft);
      continue;
    }
    if (ft.roles.length === 2) mapBinary(context, ft);
  }
}

function reifiedNodeOf(context: GraphContext, ft: FactType): NodeTable | undefined {
  for (const table of context.nodes.values()) {
    if (table.isReified && table.sourceId === ft.id) return table;
  }
  return undefined;
}

/** Each role of a reified fact becomes either a property or a relationship. */
function mapReifiedRoles(context: GraphContext, ft: FactType, node: NodeTable): void {
  for (const role of ft.roles) {
    if (!role.objectTypeId) continue;
    const player = context.index.objectTypes.get(role.objectTypeId);
    if (!player) continue;

    if (player.kind === 'value' && !context.promoted.has(player.id)) {
      node.properties.push({
        name: uniquePropertyName(node, propertyName(role.name ?? player.name)),
        dataType: player.dataType ?? 'string',
        length: player.dataTypeLength,
        scale: player.dataTypeScale,
        isRequired: isMandatory(context, role.id),
        allowedValues: valueConstraintFor(context, role.id, player.id),
        sourceRoleId: role.id,
        sourceObjectTypeId: player.id,
        comment: `Role in "${readingLabel(context, ft)}"`,
      });
      continue;
    }

    const target = nodeTableFor(context, player.id);
    if (!target) continue;
    const roleName = role.name ?? player.name;
    const key = `${relType(`has ${roleName}`)}->${target.name}`;
    const existing = context.roleLinks.get(key);
    if (existing) {
      // A second reified fact plays the same role: add an endpoint pair rather
      // than a second table with a near-identical name.
      if (!existing.pairs.some((pair) => pair.from === node.name && pair.to === target.name)) {
        existing.pairs.push({ from: node.name, to: target.name });
      }
      existing.sources.push({ kind: 'factType', id: ft.id });
      continue;
    }
    const table: RelTable = {
      name: uniqueRelName(context, relType(`has ${roleName}`)),
      sources: [{ kind: 'factType', id: ft.id }],
      pairs: [{ from: node.name, to: target.name }],
      // Every fact has exactly one player per role, so this side is functional.
      multiplicity: 'MANY_ONE',
      properties: [],
      comment: `Links each reified fact to its ${roleName} role player`,
    };
    context.roleLinks.set(key, table);
    context.rels.push(table);
  }
}

function mapUnary(context: GraphContext, ft: FactType): void {
  const role = ft.roles[0];
  if (!role.objectTypeId) return;
  const node = nodeTableFor(context, role.objectTypeId);
  if (!node) return;
  const reading = primaryReading(ft);
  node.properties.push({
    name: uniquePropertyName(node, propertyName(reading ? `is ${predicateText(reading)}` : 'flag')),
    dataType: 'boolean',
    isRequired: isMandatory(context, role.id),
    sourceRoleId: role.id,
    comment: `Unary fact type "${readingLabel(context, ft)}"`,
  });
}

function mapBinary(context: GraphContext, ft: FactType): void {
  const [first, second] = ft.roles;
  if (!first.objectTypeId || !second.objectTypeId) return;
  const firstPlayer = context.index.objectTypes.get(first.objectTypeId);
  const secondPlayer = context.index.objectTypes.get(second.objectTypeId);
  if (!firstPlayer || !secondPlayer) return;

  // A value type that stayed lexical folds into the entity as a property.
  const firstIsProperty = firstPlayer.kind === 'value' && !context.promoted.has(firstPlayer.id);
  const secondIsProperty = secondPlayer.kind === 'value' && !context.promoted.has(secondPlayer.id);
  if (firstIsProperty !== secondIsProperty) {
    const valueRole = firstIsProperty ? first : second;
    const ownerRole = firstIsProperty ? second : first;
    const valuePlayer = firstIsProperty ? firstPlayer : secondPlayer;
    const node = ownerRole.objectTypeId ? nodeTableFor(context, ownerRole.objectTypeId) : undefined;
    if (node) {
      // Holding the value in a single-valued property is the uniqueness constraint.
      markEnforced(context, ownerRole.id);
      node.properties.push({
        name: uniquePropertyName(node, propertyName(valueRole.name ?? valuePlayer.name)),
        dataType: valuePlayer.dataType ?? 'string',
        length: valuePlayer.dataTypeLength,
        scale: valuePlayer.dataTypeScale,
        isRequired: isMandatory(context, ownerRole.id),
        allowedValues: valueConstraintFor(context, valueRole.id, valuePlayer.id),
        sourceRoleId: valueRole.id,
        sourceObjectTypeId: valuePlayer.id,
        comment: `From "${readingLabel(context, ft)}"`,
      });
    }
    return;
  }

  const fromNode = nodeTableFor(context, first.objectTypeId);
  const toNode = nodeTableFor(context, second.objectTypeId);
  if (!fromNode || !toNode) return;

  const reading = primaryReading(ft);
  const predicate = reading ? predicateText(reading) : '';
  context.rels.push({
    name: uniqueRelName(context, relType(predicate || `${fromNode.name} ${toNode.name}`)),
    sources: [{ kind: 'factType', id: ft.id }],
    pairs: [{ from: fromNode.name, to: toNode.name }],
    multiplicity: multiplicityOf(context, ft, first, second),
    properties: [],
    comment: `Fact type "${readingLabel(context, ft)}"`,
  });
}

/**
 * Reads the relationship multiplicity off the uniqueness constraints: a
 * uniqueness constraint on a role says each player of that role appears at
 * most once, so that end is the "one" end.
 */
function multiplicityOf(context: GraphContext, ft: FactType, from: Role, to: Role): Multiplicity {
  const fromUnique = hasSingleRoleUniqueness(context, from.id);
  const toUnique = hasSingleRoleUniqueness(context, to.id);
  void ft;
  // A "one" end is exactly what a single-role uniqueness constraint asserts.
  if (fromUnique) markEnforced(context, from.id);
  if (toUnique) markEnforced(context, to.id);
  if (fromUnique && toUnique) return 'ONE_ONE';
  if (fromUnique) return 'MANY_ONE';
  if (toUnique) return 'ONE_MANY';
  return 'MANY_MANY';
}

function createSubtypeRels(context: GraphContext): void {
  if (context.strategy !== 'nodeTable') {
    addDiscriminators(context);
    return;
  }
  for (const relation of context.model.subtypeRelations) {
    const sub = nodeTableFor(context, relation.subtypeId);
    const sup = nodeTableFor(context, relation.supertypeId);
    if (!sub || !sup) continue;
    const name = relType(`is a ${sup.name}`);
    const existing = context.rels.find((rel) => rel.name === name && rel.sources[0].kind === 'subtype');
    if (existing) {
      existing.pairs.push({ from: sub.name, to: sup.name });
      existing.sources.push({ kind: 'subtype', id: relation.id });
      continue;
    }
    context.rels.push({
      name: uniqueRelName(context, name),
      sources: [{ kind: 'subtype', id: relation.id }],
      pairs: [{ from: sub.name, to: sup.name }],
      multiplicity: 'ONE_ONE',
      properties: [],
      comment: `Subtype link: each ${sub.name} is a kind of ${sup.name}`,
    });
  }
}

/** With `absorb`, an exclusive subtype partition becomes a discriminator. */
function addDiscriminators(context: GraphContext): void {
  for (const constraint of context.model.constraints) {
    if (constraint.kind !== 'subtypeSet' || !constraint.isExclusive) continue;
    const node = nodeTableFor(context, constraint.supertypeId);
    const supertype = context.index.objectTypes.get(constraint.supertypeId);
    if (!node || !supertype) continue;
    const names = constraint.subtypeRelationIds
      .map((id) => context.index.subtypeRelations.get(id))
      .map((rel) => (rel ? context.index.objectTypes.get(rel.subtypeId)?.name : undefined))
      .filter((n): n is string => !!n);
    if (names.length < 2) continue;
    const name = propertyName(`${supertype.name} type`);
    if (node.properties.some((p) => p.name === name)) continue;
    node.properties.push({
      name,
      dataType: 'string',
      isRequired: !!constraint.isExhaustive,
      allowedValues: names.map((value) => ({ value })),
      comment: `Discriminator for subtypes of ${supertype.name}`,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Constraints the schema cannot enforce                                       */
/* -------------------------------------------------------------------------- */

/**
 * LadybugDB enforces primary keys and relationship multiplicities. Everything
 * else ORM can say — mandatory roles, value ranges, ring, set-comparison and
 * external uniqueness constraints — is carried over as verbalized comments so
 * the rules stay visible to whoever writes the application.
 */
function collectUnenforced(context: GraphContext): void {
  for (const constraint of context.model.constraints) {
    if (context.enforced.has(constraint.id)) continue;
    const text = verbalizeConstraint(context.model, context.index, constraint);
    if (!text) continue;
    context.unenforced.push({ constraintId: constraint.id, kind: constraint.kind, text });
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function nodeTableFor(context: GraphContext, objectTypeId: Id): NodeTable | undefined {
  const target = context.absorbedInto.get(objectTypeId) ?? objectTypeId;
  return context.nodes.get(target);
}

function isObjectified(context: GraphContext, ft: FactType): boolean {
  return context.model.objectTypes.some((o) => o.objectifiedFactTypeId === ft.id);
}

function isMandatory(context: GraphContext, roleId: Id): boolean {
  const mandatory = context.model.constraints.some(
    (c) => c.kind === 'mandatory' && c.roles.length === 1 && c.roles[0] === roleId,
  );
  if (!mandatory) return false;
  // A role mandatory for a subtype is only mandatory for those instances, so it
  // cannot be required once the subtype is absorbed into its supertype's node.
  const player = context.index.roles.get(roleId)?.objectTypeId;
  if (player && context.absorbedInto.has(player)) {
    const name = context.index.objectTypes.get(player)?.name ?? player;
    const note = `"${name}" is absorbed, so its mandatory roles become optional properties on the supertype node.`;
    if (!context.notes.includes(note)) context.notes.push(note);
    return false;
  }
  return true;
}

/** Records the single-role uniqueness constraint over `roleId` as enforced. */
function markEnforced(context: GraphContext, roleId: Id): void {
  for (const constraint of context.model.constraints) {
    if (constraint.kind === 'uniqueness' && constraint.roles.length === 1 && constraint.roles[0] === roleId) {
      context.enforced.add(constraint.id);
    }
  }
}

function hasSingleRoleUniqueness(context: GraphContext, roleId: Id): boolean {
  return context.model.constraints.some(
    (c) => c.kind === 'uniqueness' && c.roles.length === 1 && c.roles[0] === roleId,
  );
}

function valueConstraintFor(context: GraphContext, roleId: Id, objectTypeId: Id): ValueRange[] | undefined {
  const constraint = context.model.constraints.find(
    (c) => c.kind === 'value' && (c.roleId === roleId || c.objectTypeId === objectTypeId),
  );
  return constraint && constraint.kind === 'value' ? constraint.ranges : undefined;
}

function refModeDataType(refMode: string): DataType {
  const lower = refMode.toLowerCase();
  if (/(nr|no|number|id|count|seq)$/.test(lower)) return 'integer';
  if (/(date)$/.test(lower)) return 'date';
  if (/(amount|price|total)$/.test(lower)) return 'money';
  return 'string';
}

/** "Person works for Company" — the reading with its role players filled in. */
function readingLabel(context: GraphContext, ft: FactType): string {
  return factTypeName(context.model, ft);
}

/**
 * A reified n-ary node is named after its whole reading, so the label says
 * which fact it stands for. Objectifying the fact type in the diagram is the
 * ORM-native way to give it a shorter name of your own.
 */
function factLabel(context: GraphContext, ft: FactType): string {
  const full = readingLabel(context, ft);
  if (!full.trim()) return 'Fact';
  const parts = words(full);
  const kept: string[] = [];
  let length = 0;
  for (const part of parts) {
    if (length + part.length > 44 && kept.length) break;
    kept.push(part);
    length += part.length;
  }
  return kept.join(' ');
}

function uniqueNodeName(context: GraphContext, base: string): string {
  return uniqueName(context.usedNodeNames, base || 'Node');
}

function uniqueRelName(context: GraphContext, base: string): string {
  return uniqueName(context.usedRelNames, base || 'RELATED_TO');
}

function uniqueName(used: Set<string>, base: string): string {
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    name = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

function uniquePropertyName(node: NodeTable, base: string): string {
  let name = base;
  let suffix = 2;
  while (node.properties.some((p) => p.name === name)) {
    name = `${base}${suffix}`;
    suffix += 1;
  }
  return name;
}

/** Node labels are PascalCase, the usual property-graph convention. */
export function nodeLabel(name: string): string {
  return words(name)
    .map((word) => (word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
}

/** Relationship types are UPPER_SNAKE_CASE. */
export function relType(name: string): string {
  return words(name)
    .map((word) => word.toUpperCase())
    .join('_');
}

/** Properties are camelCase. */
export function propertyName(name: string): string {
  const label = nodeLabel(name);
  return label ? label.charAt(0).toLowerCase() + label.slice(1) : 'property';
}

function words(value: string): string[] {
  return value
    .replace(/[^A-Za-z0-9]+/g, ' ')
    // Split PascalCase/camelCase so a node label yields readable UPPER_SNAKE.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(' ')
    .filter(Boolean);
}
