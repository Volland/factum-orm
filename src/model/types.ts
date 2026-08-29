/**
 * Object-Role Modeling (ORM 2) conceptual schema types.
 *
 * The on-disk `.orm.json` format is exactly this structure. It is deliberately
 * flat and id-based so that diffs stay small and every element can be addressed
 * from constraints, the diagram layout and diagnostics.
 */

export type Id = string;

/**
 * Major version of the on-disk format. Version 2 adds `meta` and `hints` to
 * every element; version 1 files are valid version 2 files and are upgraded in
 * place on load.
 */
export const MODEL_FORMAT_VERSION = 2;

/** Canonical location of the JSON Schema that validates a `.orm.json` file. */
export const MODEL_SCHEMA_URL =
  'https://volland.github.io/factum-orm/schema/orm-model-2.schema.json';

/* -------------------------------------------------------------------------- */
/* Metadata and extensions                                                     */
/* -------------------------------------------------------------------------- */

// @lat: [[file-format#Extensions]]
/**
 * Vendor extension keys. Anything starting with `x-` is ignored by the editor
 * and preserved verbatim on load and save, following the OpenAPI convention.
 */
export interface Extensible {
  [key: `x-${string}`]: unknown;
}

/**
 * Guidance for language models and other consumers, mirroring the `ai_context`
 * object of the Apache Ossie semantic model specification.
 */
export interface AiContext extends Extensible {
  instructions?: string;
  synonyms?: string[];
  examples?: string[];
}

// @lat: [[file-format#Metadata]]
/**
 * Descriptive metadata carried by the model and by every element in it. None
 * of it changes the meaning of the schema; it exists to survive a round trip
 * through other fact-based modeling tools and to feed generators.
 */
export interface Meta extends Extensible {
  /**
   * Stable cross-tool identity. Element `id`s are short and readable so that
   * diffs stay small; a `guid` is what other tools — NORMA, Boston, the FBM
   * Exchange MetaModel — key on, and is preserved across a round trip.
   */
  guid?: string;
  /** IRI denoting this element, for RDF/OWL and ontology alignment. */
  uri?: string;
  /** Display name when it differs from the technical `name`. */
  title?: string;
  /** One-line summary. Maps to FBM `ShortDescription`. */
  shortDescription?: string;
  /** Long-form documentation. Maps to FBM `LongDescription`. */
  description?: string;
  /** Alternative names. Maps to FBM `Synonyms` and Ossie `ai_context.synonyms`. */
  synonyms?: string[];
  /** Free-form classification, e.g. `pii`, `deprecated`. */
  tags?: string[];
  aiContext?: AiContext;
  /** Where this element came from, set by importers. */
  source?: MetaSource;
}

/** Provenance recorded by an importer or generator. */
export interface MetaSource extends Extensible {
  /** Tool that produced the element, e.g. `NORMA`, `Boston`, `Ossie`. */
  tool?: string;
  /** Version of that tool or of its exchange format. */
  version?: string;
  /** Identifier the element had in the source document. */
  ref?: string;
}

/* -------------------------------------------------------------------------- */
/* Schema generation hints                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Overrides for the relational mapping. A hint never changes the conceptual
 * schema — it only decides how that schema is rendered as tables.
 */
export interface RelationalHints extends Extensible {
  /** Schema/database qualifier for generated tables. Model level only. */
  schemaName?: string;
  /** Physical table name. Maps to FBM `DBName` on object and fact types. */
  tableName?: string;
  /** Physical column name for a value type or a role. */
  columnName?: string;
  /** Verbatim SQL type, used instead of the type derived from `dataType`. */
  sqlType?: string;
  /**
   * Forces how a functional fact type maps: `absorb` as a column into the
   * player's table, or `separateTable` as a table of its own.
   */
  mapping?: 'absorb' | 'separateTable';
}

/**
 * Overrides for the property graph mapping, covering the same ground as the
 * FBM `GraphLabel` element and the UMS `Labels` / `Label` fields.
 */
export interface GraphHints extends Extensible {
  /** Node label for an object type, or relationship type for a fact type. */
  label?: string;
  /** Additional node labels, for stores that allow more than one. */
  labels?: string[];
  /** Property name when a value type is absorbed as a property. */
  propertyName?: string;
  /**
   * Forces a value type to become a node of its own or stay a property,
   * overriding the many-to-many test the mapper would otherwise apply.
   */
  mapping?: 'node' | 'property';
}

// @lat: [[file-format#Hints]]
/**
 * Per-target hints consulted by the generators. Unknown target keys are legal
 * and are preserved, so a downstream tool can carry its own without a format
 * change — `hints.ossie`, `hints.typedb` and so on.
 */
export interface Hints extends Extensible {
  relational?: RelationalHints;
  graph?: GraphHints;
  [target: string]: unknown;
}

/** Everything that can carry metadata, hints and vendor extensions. */
export interface Annotated extends Extensible {
  meta?: Meta;
  hints?: Hints;
}

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

export interface ObjectType extends Annotated {
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
  /** Sample instances: the values a value type takes, or an entity type's identifiers. */
  population?: (string | number | boolean)[];
  /** Set when this entity type objectifies a fact type (nesting). */
  objectifiedFactTypeId?: Id;
  /** True when the objectification is implied rather than explicitly named. */
  isImplicitObjectification?: boolean;
  note?: string;
}

export interface Role extends Annotated {
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
export interface Reading extends Annotated {
  id: Id;
  roleOrder: Id[];
  text: string;
  isPrimary?: boolean;
  /**
   * BCP 47 tag of the language this reading is written in. Absent means the
   * model's `lang`. Several tools key readings by language; carrying the tag
   * keeps a multilingual model from collapsing on a round trip.
   */
  lang?: string;
}

/**
 * One tuple of a fact type's sample population — a concrete example of the fact,
 * with one value per role in the fact type's own role order.
 *
 * Populations are what fact-based modelling starts from: the modeller writes
 * example sentences, and the model is derived from them. Keeping them in the
 * file lets the verbalizer substitute real values back in, lets the validator
 * check the constraints against the examples, and gives the generators seed
 * data and test fixtures.
 */
export interface FactInstance extends Extensible {
  id?: Id;
  /** One entry per role, positionally. `null` means the value is unknown. */
  values: (string | number | boolean | null)[];
}

export interface FactType extends Annotated {
  id: Id;
  roles: Role[];
  readings: Reading[];
  /** Sample tuples, in the fact type's role order. */
  population?: FactInstance[];
  isDerived?: boolean;
  /** Derived fact types may be stored ("derived and stored") or purely derived. */
  isStored?: boolean;
  derivationRule?: string;
  note?: string;
}

export interface SubtypeRelation extends Annotated {
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

interface ConstraintBase extends Annotated {
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

export interface Shape extends Extensible {
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

export interface Diagram extends Extensible {
  name?: string;
  /** Keyed by object type / fact type / constraint / subtype relation id. */
  shapes: Record<Id, Shape>;
}

/** Identifies the software that wrote the file, for interchange provenance. */
export interface Generator extends Extensible {
  name: string;
  version?: string;
}

export interface OrmModel extends Annotated {
  /** URL of the JSON Schema this document claims to satisfy. */
  $schema?: string;
  /** Major format version. See {@link MODEL_FORMAT_VERSION}. */
  version: number;
  name: string;
  /** BCP 47 tag for readings that carry no `lang` of their own. */
  lang?: string;
  note?: string;
  generator?: Generator;
  objectTypes: ObjectType[];
  factTypes: FactType[];
  subtypeRelations: SubtypeRelation[];
  constraints: Constraint[];
  diagram: Diagram;
}
