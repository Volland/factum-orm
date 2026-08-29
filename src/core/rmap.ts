import { DataType, FactType, Id, ObjectType, OrmModel, Role, ValueRange } from '../model/types.js';
import {
  factTypeOfRole,
  indexModel,
  ModelIndex,
  predicateText,
  primaryReading,
  readingStartingAt,
} from '../model/model.js';

/* -------------------------------------------------------------------------- */
/* Relational schema shape                                                     */
/* -------------------------------------------------------------------------- */

export interface Column {
  name: string;
  dataType: DataType;
  length?: number;
  scale?: number;
  nullable: boolean;
  /** Where the column came from, so the UI can trace it back to the diagram. */
  sourceRoleId?: Id;
  sourceObjectTypeId?: Id;
  comment?: string;
}

export interface ForeignKey {
  name: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
}

export interface CheckConstraint {
  name: string;
  column: string;
  ranges: ValueRange[];
}

export interface Table {
  name: string;
  sourceKind: 'objectType' | 'factType';
  sourceId: Id;
  columns: Column[];
  primaryKey: string[];
  uniques: string[][];
  foreignKeys: ForeignKey[];
  checks: CheckConstraint[];
  comment?: string;
}

export interface RelationalSchema {
  name: string;
  tables: Table[];
  /** Human-readable notes about mapping choices, shown next to the schema. */
  notes: string[];
}

/* -------------------------------------------------------------------------- */
/* Rmap                                                                        */
/* -------------------------------------------------------------------------- */

interface MapContext {
  model: OrmModel;
  index: ModelIndex;
  /** Object type id -> table it is absorbed into (subtype absorption). */
  absorbedInto: Map<Id, Id>;
  tables: Map<Id, Table>;
  notes: string[];
}

/**
 * Maps a conceptual schema to a relational schema using the Rmap procedure:
 * compound-unique fact types get their own table, functional fact types are
 * absorbed as columns into the table of the object type playing the unique
 * role, unaries become booleans, and subtypes are absorbed into their
 * supertype's table.
 */
export function mapToRelational(model: OrmModel): RelationalSchema {
  const context: MapContext = {
    model,
    index: indexModel(model),
    absorbedInto: new Map(),
    tables: new Map(),
    notes: [],
  };

  planSubtypeAbsorption(context);
  createBaseTables(context);
  mapFactTypes(context);
  addObjectTypeChecks(context);
  addDiscriminators(context);

  const tables = [...context.tables.values()].filter(
    (table) => table.columns.length > 0,
  );
  for (const table of tables) dedupeColumns(table);

  return { name: model.name, tables, notes: context.notes };
}

function planSubtypeAbsorption(context: MapContext): void {
  const { model } = context;
  for (const ot of model.objectTypes) {
    const root = rootSupertype(context, ot.id);
    if (root !== ot.id) {
      context.absorbedInto.set(ot.id, root);
      const rootName = context.index.objectTypes.get(root)?.name ?? root;
      context.notes.push(`"${ot.name}" is absorbed into "${rootName}" (subtype absorption); its columns are optional.`);
    }
  }
}

function rootSupertype(context: MapContext, objectTypeId: Id): Id {
  const seen = new Set<Id>([objectTypeId]);
  let current = objectTypeId;
  for (;;) {
    const relations = context.model.subtypeRelations.filter((s) => s.subtypeId === current);
    if (!relations.length) return current;
    const preferred = relations.find((s) => s.isPreferredIdentificationPath) ?? relations[0];
    if (seen.has(preferred.supertypeId)) return current; // cycle guard
    seen.add(preferred.supertypeId);
    current = preferred.supertypeId;
  }
}

function createBaseTables(context: MapContext): void {
  const { model, index } = context;

  for (const ot of model.objectTypes) {
    if (ot.kind !== 'entity') continue;
    if (context.absorbedInto.has(ot.id)) continue;
    if (ot.objectifiedFactTypeId) continue; // handled with its fact type

    const table: Table = {
      name: tableName(ot.name),
      sourceKind: 'objectType',
      sourceId: ot.id,
      columns: [],
      primaryKey: [],
      uniques: [],
      foreignKeys: [],
      checks: [],
      comment: `Object type ${ot.name}`,
    };
    for (const column of identifyingColumns(context, ot, new Set())) {
      table.columns.push({ ...column, nullable: false });
      table.primaryKey.push(column.name);
    }
    context.tables.set(ot.id, table);
  }

  // Objectified fact types become a table keyed by the objectified roles.
  for (const ot of model.objectTypes) {
    if (!ot.objectifiedFactTypeId) continue;
    const ft = index.factTypes.get(ot.objectifiedFactTypeId);
    if (!ft) continue;
    const table: Table = {
      name: tableName(ot.name),
      sourceKind: 'factType',
      sourceId: ft.id,
      columns: [],
      primaryKey: [],
      uniques: [],
      foreignKeys: [],
      checks: [],
      comment: `Objectified fact type "${readingLabel(ft)}" (${ot.name})`,
    };
    const keyRoles = preferredKeyRoles(context, ft);
    for (const role of ft.roles) {
      const columns = columnsForRole(context, role, !keyRoles.includes(role.id));
      appendColumns(context, table, columns, role);
      if (keyRoles.includes(role.id)) table.primaryKey.push(...columns.map((c) => c.name));
    }
    context.tables.set(ot.id, table);
    context.notes.push(`"${ot.name}" objectifies "${readingLabel(ft)}" and maps to its own table.`);
  }
}

function mapFactTypes(context: MapContext): void {
  const { model } = context;
  for (const ft of model.factTypes) {
    if (isObjectified(context, ft)) {
      mapRolesOfObjectifyingType(context, ft);
      continue;
    }
    const arity = ft.roles.length;
    if (arity === 0) continue;
    if (arity === 1) {
      mapUnary(context, ft);
      continue;
    }
    const functionalRole = functionalRoleOf(context, ft);
    if (arity === 2 && functionalRole) {
      absorbBinary(context, ft, functionalRole);
      continue;
    }
    mapAsTable(context, ft);
  }
}

/** Roles the objectifying entity type plays elsewhere land in its own table. */
function mapRolesOfObjectifyingType(_context: MapContext, _ft: FactType): void {
  // Nothing to do: the objectified table is created in createBaseTables and the
  // entity type's other roles are mapped like any other object type's roles.
}

function mapUnary(context: MapContext, ft: FactType): void {
  const role = ft.roles[0];
  const table = tableForRolePlayer(context, role);
  if (!table || !role.objectTypeId) return;
  const reading = primaryReading(ft);
  const name = columnName(reading ? `is ${predicateText(reading)}` : 'flag');
  table.columns.push({
    name,
    dataType: 'boolean',
    nullable: !isMandatory(context, role.id),
    sourceRoleId: role.id,
    comment: `Unary fact type "${readingLabel(ft)}"`,
  });
}

/**
 * Absorbs an n:1 or 1:1 binary into the table of the object type playing the
 * uniquely-constrained role.
 */
function absorbBinary(context: MapContext, ft: FactType, functionalRole: Role): void {
  const otherRole = ft.roles.find((r) => r.id !== functionalRole.id);
  if (!otherRole) return;
  const table = tableForRolePlayer(context, functionalRole);
  if (!table) {
    mapAsTable(context, ft);
    return;
  }
  const mandatory = isMandatory(context, functionalRole.id);
  const absorbedIntoSubtype = context.absorbedInto.has(functionalRole.objectTypeId ?? '');
  const columns = columnsForRole(context, otherRole, !mandatory || absorbedIntoSubtype, ft);
  appendColumns(context, table, columns, otherRole);

  // A 1:1 fact type also makes the absorbed column unique.
  if (isRoleUnique(context, otherRole.id) && columns.length) {
    table.uniques.push(columns.map((c) => c.name));
  }
  if (absorbedIntoSubtype && mandatory) {
    context.notes.push(
      `"${readingLabel(ft)}" is mandatory but absorbed into a supertype table, so its column is optional there.`,
    );
  }
}

function mapAsTable(context: MapContext, ft: FactType): void {
  const table: Table = {
    name: tableName(factTableName(context, ft)),
    sourceKind: 'factType',
    sourceId: ft.id,
    columns: [],
    primaryKey: [],
    uniques: [],
    foreignKeys: [],
    checks: [],
    comment: `Fact type "${readingLabel(ft)}"`,
  };
  const keyRoles = preferredKeyRoles(context, ft);
  for (const role of ft.roles) {
    const isKey = keyRoles.includes(role.id);
    const columns = columnsForRole(context, role, !isKey && !isMandatory(context, role.id), ft);
    appendColumns(context, table, columns, role);
    if (isKey) table.primaryKey.push(...columns.map((c) => c.name));
  }
  if (!table.primaryKey.length) table.primaryKey = table.columns.map((c) => c.name);
  context.tables.set(ft.id, table);
}

/* -------------------------------------------------------------------------- */
/* Column construction                                                         */
/* -------------------------------------------------------------------------- */

function appendColumns(context: MapContext, table: Table, columns: Column[], role: Role): void {
  if (!columns.length) return;
  table.columns.push(...columns);
  const player = role.objectTypeId ? context.index.objectTypes.get(role.objectTypeId) : undefined;
  if (!player || player.kind !== 'entity') return;
  const targetTable = tableForObjectType(context, player.id);
  if (!targetTable || targetTable.name === table.name || !targetTable.primaryKey.length) return;
  table.foreignKeys.push({
    name: `FK_${table.name}_${targetTable.name}`,
    columns: columns.map((c) => c.name),
    refTable: targetTable.name,
    refColumns: targetTable.primaryKey,
  });
}

/**
 * Columns representing a role: the player's identifying columns, prefixed with
 * the role name where one is given.
 */
function columnsForRole(context: MapContext, role: Role, nullable: boolean, ft?: FactType): Column[] {
  if (!role.objectTypeId) return [];
  const player = context.index.objectTypes.get(role.objectTypeId);
  if (!player) return [];
  const prefix = role.name ?? (ft ? roleReadingPrefix(ft, role) : undefined);
  return identifyingColumns(context, player, new Set()).map((column) => ({
    ...column,
    name: prefix ? columnName(`${prefix} ${column.name}`) : column.name,
    nullable,
    sourceRoleId: role.id,
    comment: ft ? `From "${readingLabel(ft)}"` : column.comment,
  }));
}

/** Identifying (primary key) columns of an object type, expanded recursively. */
function identifyingColumns(context: MapContext, ot: ObjectType, visiting: Set<Id>): Column[] {
  if (visiting.has(ot.id)) {
    return [{ name: columnName(`${ot.name} id`), dataType: 'integer', nullable: false, sourceObjectTypeId: ot.id }];
  }
  visiting.add(ot.id);

  if (ot.kind === 'value') {
    return [
      {
        name: columnName(ot.name),
        dataType: ot.dataType ?? 'string',
        length: ot.dataTypeLength,
        scale: ot.dataTypeScale,
        nullable: false,
        sourceObjectTypeId: ot.id,
      },
    ];
  }

  if (ot.refMode) {
    return [
      {
        name: columnName(`${ot.name} ${ot.refMode}`),
        dataType: ot.dataType ?? refModeDataType(ot.refMode),
        length: ot.dataTypeLength,
        scale: ot.dataTypeScale,
        nullable: false,
        sourceObjectTypeId: ot.id,
      },
    ];
  }

  if (ot.objectifiedFactTypeId) {
    const ft = context.index.factTypes.get(ot.objectifiedFactTypeId);
    if (ft) {
      const keyRoles = preferredKeyRoles(context, ft);
      return ft.roles
        .filter((r) => keyRoles.includes(r.id))
        .flatMap((r) => {
          if (!r.objectTypeId) return [];
          const player = context.index.objectTypes.get(r.objectTypeId);
          return player ? identifyingColumns(context, player, visiting) : [];
        });
    }
  }

  // Explicit preferred identifier: the roles opposite this object type.
  const preferred = context.model.constraints.find(
    (c) =>
      c.kind === 'uniqueness' &&
      c.isPreferredIdentifier &&
      c.roles.some((roleId) => {
        const owner = factTypeOfRole(context.model, roleId);
        return !!owner && owner.roles.some((r) => r.id !== roleId && r.objectTypeId === ot.id);
      }),
  );
  if (preferred && preferred.kind === 'uniqueness') {
    const columns = preferred.roles.flatMap((roleId) => {
      const owner = factTypeOfRole(context.model, roleId);
      const role = owner?.roles.find((r) => r.id === roleId);
      if (!owner || !role || !role.objectTypeId) return [];
      const player = context.index.objectTypes.get(role.objectTypeId);
      return player ? identifyingColumns(context, player, visiting) : [];
    });
    if (columns.length) return columns;
  }

  // Fall back to a surrogate key so the schema still generates.
  context.notes.push(`"${ot.name}" has no reference scheme; a surrogate key column was generated.`);
  return [{ name: columnName(`${ot.name} id`), dataType: 'autoCounter', nullable: false, sourceObjectTypeId: ot.id }];
}

function refModeDataType(refMode: string): DataType {
  const lower = refMode.toLowerCase();
  if (/(nr|no|number|id|count|seq)$/.test(lower)) return 'integer';
  if (/(date)$/.test(lower)) return 'date';
  if (/(amount|price|total)$/.test(lower)) return 'money';
  return 'string';
}

/* -------------------------------------------------------------------------- */
/* Constraint mapping                                                          */
/* -------------------------------------------------------------------------- */

function addObjectTypeChecks(context: MapContext): void {
  for (const constraint of context.model.constraints) {
    if (constraint.kind !== 'value') continue;
    const targets: { table: Table; column: Column }[] = [];
    for (const table of context.tables.values()) {
      for (const column of table.columns) {
        const matchesObject = constraint.objectTypeId && column.sourceObjectTypeId === constraint.objectTypeId;
        const matchesRole = constraint.roleId && column.sourceRoleId === constraint.roleId;
        if (matchesObject || matchesRole) targets.push({ table, column });
      }
    }
    for (const { table, column } of targets) {
      table.checks.push({
        name: `CK_${table.name}_${column.name}`,
        column: column.name,
        ranges: constraint.ranges,
      });
    }
  }
}

/** An exclusive+exhaustive subtype partition becomes a discriminator column. */
function addDiscriminators(context: MapContext): void {
  for (const constraint of context.model.constraints) {
    if (constraint.kind !== 'subtypeSet' || !constraint.isExclusive) continue;
    const table = tableForObjectType(context, constraint.supertypeId);
    const supertype = context.index.objectTypes.get(constraint.supertypeId);
    if (!table || !supertype) continue;
    const subtypeNames = constraint.subtypeRelationIds
      .map((id) => context.index.subtypeRelations.get(id))
      .map((rel) => (rel ? context.index.objectTypes.get(rel.subtypeId)?.name : undefined))
      .filter((n): n is string => !!n);
    if (subtypeNames.length < 2) continue;
    const name = columnName(`${supertype.name} type`);
    if (table.columns.some((c) => c.name === name)) continue;
    table.columns.push({
      name,
      dataType: 'string',
      length: 32,
      nullable: !constraint.isExhaustive,
      comment: `Discriminator for subtypes of ${supertype.name}`,
    });
    table.checks.push({
      name: `CK_${table.name}_${name}`,
      column: name,
      ranges: subtypeNames.map((value) => ({ value })),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function isObjectified(context: MapContext, ft: FactType): boolean {
  return context.model.objectTypes.some((o) => o.objectifiedFactTypeId === ft.id);
}

function isMandatory(context: MapContext, roleId: Id): boolean {
  return context.model.constraints.some(
    (c) => c.kind === 'mandatory' && c.roles.length === 1 && c.roles[0] === roleId,
  );
}

function isRoleUnique(context: MapContext, roleId: Id): boolean {
  return context.model.constraints.some(
    (c) => c.kind === 'uniqueness' && c.roles.length === 1 && c.roles[0] === roleId,
  );
}

/**
 * The role whose single-role uniqueness constraint makes a binary functional.
 * For 1:1 fact types the mandatory side wins, so the column lands where it is
 * never null.
 */
function functionalRoleOf(context: MapContext, ft: FactType): Role | undefined {
  const unique = ft.roles.filter((role) => isRoleUnique(context, role.id));
  if (!unique.length) return undefined;
  if (unique.length === 1) return unique[0];
  const mandatory = unique.find((role) => isMandatory(context, role.id));
  return mandatory ?? unique[0];
}

/** Roles forming the primary key of a fact table: the narrowest internal UC. */
function preferredKeyRoles(context: MapContext, ft: FactType): Id[] {
  const roleIds = new Set(ft.roles.map((r) => r.id));
  const internal = context.model.constraints.filter(
    (c) => c.kind === 'uniqueness' && c.roles.length > 0 && c.roles.every((r) => roleIds.has(r)),
  );
  if (!internal.length) return ft.roles.map((r) => r.id);
  const preferred = internal.find((c) => c.kind === 'uniqueness' && c.isPreferredIdentifier);
  const chosen =
    preferred ??
    internal.reduce((best, current) =>
      (current as { roles: Id[] }).roles.length < (best as { roles: Id[] }).roles.length ? current : best,
    );
  return (chosen as { roles: Id[] }).roles;
}

function tableForObjectType(context: MapContext, objectTypeId: Id): Table | undefined {
  const target = context.absorbedInto.get(objectTypeId) ?? objectTypeId;
  return context.tables.get(target);
}

function tableForRolePlayer(context: MapContext, role: Role): Table | undefined {
  if (!role.objectTypeId) return undefined;
  return tableForObjectType(context, role.objectTypeId);
}

function readingLabel(ft: FactType): string {
  const reading = primaryReading(ft);
  return reading ? reading.text.replace(/\{\d+\}/g, '...').replace(/\s+/g, ' ').trim() : ft.id;
}

function factTableName(context: MapContext, ft: FactType): string {
  const players = ft.roles
    .map((r) => (r.objectTypeId ? context.index.objectTypes.get(r.objectTypeId)?.name : undefined))
    .filter((n): n is string => !!n);
  const reading = primaryReading(ft);
  const predicate = reading ? predicateText(reading) : '';
  if (players.length >= 2) {
    return `${players[0]}${pascal(predicate)}${players.slice(1).join('')}`;
  }
  return pascal(`${players[0] ?? 'Fact'} ${predicate}`);
}

function roleReadingPrefix(ft: FactType, role: Role): string | undefined {
  // Use the predicate as a prefix only when the same player appears twice.
  const player = role.objectTypeId;
  if (!player) return undefined;
  const sameCount = ft.roles.filter((r) => r.objectTypeId === player).length;
  if (sameCount < 2) return undefined;
  const reading = readingStartingAt(ft, role.id);
  if (reading) return predicateText(reading);
  const position = ft.roles.findIndex((r) => r.id === role.id);
  return `role${position + 1}`;
}

function dedupeColumns(table: Table): void {
  const seen = new Map<string, number>();
  for (const column of table.columns) {
    const count = seen.get(column.name) ?? 0;
    seen.set(column.name, count + 1);
    if (count > 0) {
      const renamed = `${column.name}${count + 1}`;
      for (const fk of table.foreignKeys) {
        fk.columns = fk.columns.map((c) => (c === column.name ? renamed : c));
      }
      column.name = renamed;
    }
  }
}

export function tableName(name: string): string {
  return pascal(name) || 'Table';
}

export function columnName(name: string): string {
  const pascalCase = pascal(name);
  return pascalCase ? pascalCase.charAt(0).toLowerCase() + pascalCase.slice(1) : 'column';
}

function pascal(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => (word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
}
