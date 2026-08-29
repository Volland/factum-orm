/**
 * Object-Role Modeling (ORM 2) conceptual schema types.
 *
 * The on-disk `.orm.json` format is exactly this structure. It is deliberately
 * flat and id-based so that diffs stay small and every element can be addressed
 * from constraints, the diagram layout and diagnostics.
 */

export type Id = string;

export const MODEL_FORMAT_VERSION = 1;

export type DataType =
  | 'string'
  | 'text'
  | 'integer'
  | 'decimal'
  | 'float'
  | 'money'
  | 'boolean'
  | 'date'
  | 'time'
  | 'dateTime'
  | 'guid'
  | 'binary'
  | 'autoCounter';

/** How a reference mode expands into a reference scheme. */
export type RefModeKind = 'popular' | 'unit' | 'general';

export interface ObjectType {
  id: Id;
  name: string;
  /** Entity types have a reference scheme; value types are lexical. */
  kind: 'entity' | 'value';
  /** Reference mode, e.g. `nr` in `Person(.nr)`. Entity types only. */
  refMode?: string;
  refModeKind?: RefModeKind;
  /** Data type of a value type, or of the implicit ref-mode value type. */
  dataType?: DataType;
  dataTypeLength?: number;
  dataTypeScale?: number;
  /** Independent object types may have instances that play no fact roles ("!"). */
  isIndependent?: boolean;
  /** Personal object types are verbalized with "who" rather than "that". */
  isPersonal?: boolean;
  /** Set when this entity type objectifies a fact type (nesting). */
  objectifiedFactTypeId?: Id;
  /** True when the objectification is implied rather than explicitly named. */
  isImplicitObjectification?: boolean;
  note?: string;
}

export interface Role {
  id: Id;
  /** Object type playing this role. Empty while a role is being connected. */
  objectTypeId: Id | null;
  /** Optional role name, used for role-name based verbalization and mapping. */
  name?: string;
}

/**
 * A predicate reading. `text` uses `{0}`, `{1}`, ... placeholders that index
 * into `roleOrder`, matching the NORMA convention.
 */
export interface Reading {
  id: Id;
  roleOrder: Id[];
  text: string;
  isPrimary?: boolean;
}

export interface FactType {
  id: Id;
  roles: Role[];
  readings: Reading[];
  isDerived?: boolean;
  /** Derived fact types may be stored ("derived and stored") or purely derived. */
  isStored?: boolean;
  derivationRule?: string;
  note?: string;
}

export interface SubtypeRelation {
  id: Id;
  subtypeId: Id;
  supertypeId: Id;
  /** Path along which the subtype inherits its preferred identifier. */
  isPreferredIdentificationPath?: boolean;
  note?: string;
}

export type RingType =
  | 'irreflexive'
  | 'reflexive'
  | 'purelyReflexive'
  | 'symmetric'
  | 'asymmetric'
  | 'antisymmetric'
  | 'transitive'
  | 'intransitive'
  | 'strictlyIntransitive'
  | 'acyclic';

export interface ValueRange {
  /** Discrete single value, e.g. `'M'`. Mutually exclusive with min/max. */
  value?: string | number;
  min?: string | number;
  max?: string | number;
  minInclusive?: boolean;
  maxInclusive?: boolean;
}

interface ConstraintBase {
  id: Id;
  name?: string;
  note?: string;
  /** Modality: alethic constraints cannot be violated, deontic ones should not be. */
  modality?: 'alethic' | 'deontic';
}

/**
 * Uniqueness over a set of roles. Internal when every role belongs to one fact
 * type, external (a "uniqueness circle") when the roles span several.
 */
export interface UniquenessConstraint extends ConstraintBase {
  kind: 'uniqueness';
  roles: Id[];
  /** Marks the preferred identifier of the object type opposite the roles. */
  isPreferredIdentifier?: boolean;
}

/** Simple mandatory (one role) or disjunctive mandatory / inclusive-or (many). */
export interface MandatoryConstraint extends ConstraintBase {
  kind: 'mandatory';
  roles: Id[];
  /** Implied by a preferred identifier rather than drawn by the modeler. */
  isImplied?: boolean;
}

export interface FrequencyConstraint extends ConstraintBase {
  kind: 'frequency';
  roles: Id[];
  min: number;
  /** `null` means unbounded (`n`). */
  max: number | null;
}

export interface RingConstraint extends ConstraintBase {
  kind: 'ring';
  roles: [Id, Id];
  types: RingType[];
}

/** Subset, exclusion and equality constraints compare two or more role sequences. */
export interface SetComparisonConstraint extends ConstraintBase {
  kind: 'subset' | 'exclusion' | 'equality';
  /** For `subset` the first sequence is the subset, the second the superset. */
  roleSequences: Id[][];
}

export interface ValueConstraint extends ConstraintBase {
  kind: 'value';
  /** Exactly one of these targets is set. */
  objectTypeId?: Id;
  roleId?: Id;
  ranges: ValueRange[];
}

/** Cardinality on an object type's population or on a role's player count. */
export interface CardinalityConstraint extends ConstraintBase {
  kind: 'cardinality';
  objectTypeId?: Id;
  roleId?: Id;
  min: number;
  max: number | null;
}

/** Exclusion / exhaustion over the subtypes of a common supertype. */
export interface SubtypeSetConstraint extends ConstraintBase {
  kind: 'subtypeSet';
  supertypeId: Id;
  subtypeRelationIds: Id[];
  isExclusive?: boolean;
  isExhaustive?: boolean;
}

export type Constraint =
  | UniquenessConstraint
  | MandatoryConstraint
  | FrequencyConstraint
  | RingConstraint
  | SetComparisonConstraint
  | ValueConstraint
  | CardinalityConstraint
  | SubtypeSetConstraint;

export type ConstraintKind = Constraint['kind'];

export interface Shape {
  x: number;
  y: number;
  /** Fact types are laid out horizontally or vertically. */
  orientation?: 'horizontal' | 'vertical';
  /** Explicit size; when absent the renderer measures the content. */
  w?: number;
  h?: number;
  /** Hides a shape that exists in the model but not on this diagram. */
  hidden?: boolean;
}

export interface Diagram {
  name?: string;
  /** Keyed by object type / fact type / constraint / subtype relation id. */
  shapes: Record<Id, Shape>;
}

export interface OrmModel {
  $schema?: string;
  version: number;
  name: string;
  note?: string;
  objectTypes: ObjectType[];
  factTypes: FactType[];
  subtypeRelations: SubtypeRelation[];
  constraints: Constraint[];
  diagram: Diagram;
}
