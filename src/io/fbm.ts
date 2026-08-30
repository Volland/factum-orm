/**
 * The FBM Exchange MetaModel — the FactEngine community's XML interchange
 * format for fact-based models, covering Object-Role Modeling and FCO-IM.
 *
 * Both directions are conceptual, so the round trip is close to lossless. The
 * shapes that do not line up one-to-one are readings (FBM decomposes them into
 * predicate parts, Factum uses NORMA's `{0}` placeholders) and mandatory roles
 * (FBM stores those on the role, Factum as constraints of their own).
 */

import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import {
  Constraint,
  FactInstance,
  FactType,
  Id,
  MODEL_SCHEMA_URL,
  ObjectType,
  OrmModel,
  Reading,
  RingType,
  Meta,
  Role,
  ValueRange,
} from '../model/types.js';
import { constraintRoles, emptyModel, indexModel, newId, primaryReading } from '../model/model.js';
import {
  dataTypeFromNorma,
  dataTypeToNorma,
  dropConstraintsOverRoles,
  ExportResult,
  ImportResult,
  pascalCase,
} from './interop.js';

/** The XSD revision this converter reads and writes. */
const FBM_XSD_VERSION = '1.7';

type XmlNode = Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

export function importFbmFile(xml: string): ImportResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    removeNSPrefix: true,
    parseAttributeValue: false,
    trimValues: true,
  });
  const document = parser.parse(xml) as XmlNode;
  const root = (first(document.Model) ?? document) as XmlNode;
  // Boston writes <ORMModel>; newer exports write <FBMModel>. Both occur in the
  // metamodel repository's own examples, so both are accepted.
  const ormModel = (first(root.FBMModel) ?? first(root.ORMModel)) as XmlNode | undefined;
  if (!ormModel) {
    throw new Error('Not an FBM file: no <FBMModel> or <ORMModel> element was found.');
  }

  const warnings: string[] = [];
  const model = emptyModel(str(ormModel['@Name']) ?? 'Imported Model');
  model.$schema = MODEL_SCHEMA_URL;
  model.generator = { name: 'Factum FBM importer' };
  model.meta = {
    source: {
      tool: 'FBM Exchange MetaModel',
      version: str(root['@XSDVersionNr']),
      ref: str(ormModel['@ModelId']),
    },
  };

  importObjectTypes(ormModel, model);
  // The fact type FBM generates for a subtype link is skipped, so the
  // constraints it attaches to that fact type's roles have to go with it.
  const subtypeFactRoles = new Set<Id>();
  importFactTypes(ormModel, model, subtypeFactRoles, warnings);
  importSubtypes(ormModel, model);
  importRoleConstraints(ormModel, model, warnings);
  dropConstraintsOverRoles(model, subtypeFactRoles);
  importNotesAndSynonyms(ormModel, model);
  importDiagram(root, model, warnings);

  return { model, warnings };
}

function importObjectTypes(ormModel: XmlNode, model: OrmModel): void {
  for (const container of list(ormModel.ValueTypes)) {
    for (const node of list((container as XmlNode).ValueType)) {
      const vt = node as XmlNode;
      const length = num(vt['@DataTypeLength']);
      const scale = num(vt['@DataTypePrecision']);
      const ot: ObjectType = {
        id: str(vt['@Id']) ?? newId('ot'),
        name: str(vt['@Name']) ?? 'Unnamed',
        kind: 'value',
        dataType: dataTypeFromNorma(str(vt['@DataType']) ?? ''),
        dataTypeLength: length && length > 0 ? length : undefined,
        dataTypeScale: scale && scale > 0 ? scale : undefined,
        isIndependent: bool(vt['@IsIndependent']) || undefined,
      };
      const instances = instanceValues(vt);
      if (instances.length) ot.population = instances;
      applyMeta(ot, vt);
      model.objectTypes.push(ot);

      // A value type's own value constraint is a bare list of allowed strings.
      const ranges = valueConstraintRanges(vt);
      if (ranges.length) {
        model.constraints.push({
          kind: 'value',
          id: newId('vc'),
          objectTypeId: ot.id,
          ranges,
        });
      }
    }
  }

  for (const container of list(ormModel.EntityTypes)) {
    for (const node of list((container as XmlNode).EntityType)) {
      const et = node as XmlNode;
      const refMode = str(et['@ReferenceMode'])?.replace(/^\./, '');
      const ot: ObjectType = {
        id: str(et['@Id']) ?? newId('ot'),
        name: str(et['@Name']) ?? 'Unnamed',
        kind: 'entity',
        refMode: refMode || undefined,
        isIndependent: bool(et['@IsIndependent']) || undefined,
        isPersonal: bool(et['@IsPersonal']) || undefined,
      };
      const instances = instanceValues(et);
      if (instances.length) ot.population = instances;
      applyMeta(ot, et);
      const graphLabel = firstString(et.GraphLabel);
      if (graphLabel) ot.hints = { graph: { label: graphLabel } };
      model.objectTypes.push(ot);
    }
  }
}

function importFactTypes(
  ormModel: XmlNode,
  model: OrmModel,
  subtypeFactRoles: Set<Id>,
  warnings: string[],
): void {
  for (const container of list(ormModel.FactTypes)) {
    for (const node of list((container as XmlNode).FactType)) {
      const ft = node as XmlNode;
      // Subtyping is carried by the entity types' SubtypeRelationships elements;
      // the fact type FBM generates alongside it would be a duplicate here.
      if (bool(ft['@IsSubtypeRelationshipFactType'])) {
        for (const group of list(ft.RoleGroup)) {
          for (const roleNode of list((group as XmlNode).Role)) {
            const roleId = str((roleNode as XmlNode)['@Id']);
            if (roleId) subtypeFactRoles.add(roleId);
          }
        }
        continue;
      }

      const roles: Role[] = [];
      for (const group of list(ft.RoleGroup)) {
        for (const roleNode of list((group as XmlNode).Role)) {
          const r = roleNode as XmlNode;
          roles.push({
            id: str(r['@Id']) ?? newId('r'),
            objectTypeId: str(r['@JoinedObjectTypeId']) ?? null,
            name: nonEmpty(str(r['@Name'])),
          });
        }
      }
      if (!roles.length) {
        warnings.push(`Fact type "${str(ft['@Name']) ?? str(ft['@Id'])}" has no roles and was skipped.`);
        continue;
      }

      const population = populationOf(ft, roles);
      const factType: FactType = {
        id: str(ft['@Id']) ?? newId('ft'),
        roles,
        readings: readingsOf(ft, roles),
        ...(population.length ? { population } : {}),
        isDerived: bool(ft['@IsDerived']) || undefined,
        isStored: bool(ft['@IsStored']) || undefined,
        derivationRule: nonEmpty(str(ft['@DerivationText'])),
      };
      applyMeta(factType, ft);
      const graphLabel = firstString(ft.GraphLabel);
      if (graphLabel) factType.hints = { graph: { label: graphLabel } };
      if (!factType.readings.length) {
        factType.readings = [placeholderReading(roles)];
        warnings.push(`Fact type "${factType.id}" had no reading; a placeholder was generated.`);
      }
      model.factTypes.push(factType);

      // FBM marks mandatory on the role; Factum models it as a constraint.
      for (const group of list(ft.RoleGroup)) {
        for (const roleNode of list((group as XmlNode).Role)) {
          const r = roleNode as XmlNode;
          const roleId = str(r['@Id']);
          if (!roleId || !bool(r['@Mandatory'])) continue;
          model.constraints.push({ kind: 'mandatory', id: newId('mc'), roles: [roleId] });
          const ranges = valueConstraintRanges(r);
          if (ranges.length) {
            model.constraints.push({ kind: 'value', id: newId('vc'), roleId, ranges });
          }
        }
      }

      // An objectifying entity type points back at the fact type it nests.
      const objectifier = str(ft['@ObjectifyingEntityTypeId']);
      if (objectifier) {
        const ot = model.objectTypes.find((o) => o.id === objectifier);
        if (ot) ot.objectifiedFactTypeId = factType.id;
      }
    }
  }
}

/**
 * Rebuilds a `{0} works for {1}` reading from FBM's predicate parts. Each part
 * contributes its role's placeholder followed by the text that trails it.
 */
function readingsOf(ft: XmlNode, roles: Role[]): Reading[] {
  const readings: Reading[] = [];
  for (const container of list(ft.FactTypeReadings)) {
    for (const node of list((container as XmlNode).FactTypeReading)) {
      const reading = node as XmlNode;
      const roleOrder: Id[] = [];
      const pieces: string[] = [];
      const front = str(reading['@FrontReadingText']);
      if (front) pieces.push(front);

      for (const partsNode of list(reading.PredicateParts)) {
        const parts = list((partsNode as XmlNode).PredicatePart).slice();
        parts.sort((a, b) => (num((a as XmlNode)['@SequenceNr']) ?? 0) - (num((b as XmlNode)['@SequenceNr']) ?? 0));
        for (const partNode of parts) {
          const part = partNode as XmlNode;
          const roleId = str(part['@Role_Id']);
          if (roleId) {
            const pre = str(part['@PreboundReadingText']);
            const post = str(part['@PostboundReadingText']);
            if (pre) pieces.push(pre);
            pieces.push(`{${roleOrder.length}}${post ?? ''}`);
            roleOrder.push(roleId);
          }
          const text = textOf(part.PredicatePartText);
          if (text) pieces.push(text);
        }
      }
      const following = str(reading['@FollowingReadingText']);
      if (following) pieces.push(following);

      const text = pieces.join(' ').replace(/\s+/g, ' ').trim();
      if (!text || !roleOrder.length) continue;
      readings.push({
        id: str(reading['@Id']) ?? newId('rd'),
        roleOrder,
        text,
        isPrimary: readings.length === 0 || undefined,
      });
    }
  }
  if (!readings.length && roles.length) return [];
  return readings;
}

/**
 * FBM stores a fact type's population as `Fact/Data/FactData[@RoleId]/Value`,
 * addressed by role rather than positionally.
 */
function populationOf(ft: XmlNode, roles: Role[]): FactInstance[] {
  const out: FactInstance[] = [];
  for (const container of list(ft.Facts)) {
    for (const factNode of list((container as XmlNode).Fact)) {
      const fact = factNode as XmlNode;
      for (const dataNode of list(fact.Data)) {
        const byRole = new Map<Id, string>();
        for (const cell of list((dataNode as XmlNode).FactData)) {
          const roleId = str((cell as XmlNode)['@RoleId']);
          const value = textOf((cell as XmlNode).Value) ?? str((cell as XmlNode).Value);
          if (roleId && value !== undefined) byRole.set(roleId, value);
        }
        if (!byRole.size) continue;
        out.push({
          ...(str(fact['@Id']) ? { id: str(fact['@Id']) } : {}),
          values: roles.map((role) => byRole.get(role.id) ?? null),
        });
      }
    }
  }
  return out;
}

/** An object type's `Instance` elements, each a list of `string` values. */
function instanceValues(node: XmlNode): string[] {
  const out: string[] = [];
  for (const container of list(node.Instance)) {
    for (const value of list((container as XmlNode).string)) {
      const text = typeof value === 'string' ? value : str((value as XmlNode)?.['#text']);
      if (text !== undefined && text !== '') out.push(text);
    }
  }
  return out;
}

function placeholderReading(roles: Role[]): Reading {
  return {
    id: newId('rd'),
    roleOrder: roles.map((r) => r.id),
    text: roles.map((_, i) => `{${i}}`).join(' ... '),
    isPrimary: true,
  };
}

function importSubtypes(ormModel: XmlNode, model: OrmModel): void {
  for (const container of list(ormModel.EntityTypes)) {
    for (const node of list((container as XmlNode).EntityType)) {
      const et = node as XmlNode;
      const subtypeId = str(et['@Id']);
      if (!subtypeId) continue;
      for (const relsNode of list(et.SubtypeRelationships)) {
        for (const relNode of list((relsNode as XmlNode).SubtypeRelationship)) {
          const supertypeId = str((relNode as XmlNode)['@ParentEntityTypeId']);
          if (!supertypeId) continue;
          model.subtypeRelations.push({ id: newId('st'), subtypeId, supertypeId });
        }
      }
    }
  }
}

function importRoleConstraints(ormModel: XmlNode, model: OrmModel, warnings: string[]): void {
  for (const container of list(ormModel.RoleConstraints)) {
    for (const node of list((container as XmlNode).RoleConstraint)) {
      const rc = node as XmlNode;
      const id = str(rc['@Id']) ?? newId('c');
      const name = nonEmpty(str(rc['@Name']));
      const modality = bool(rc['@IsDeontic']) ? ('deontic' as const) : undefined;
      const roles = constraintRoleIds(rc);
      const type = str(rc['@RoleConstraintType']) ?? '';

      switch (type) {
        case 'InternalUniquenessConstraint':
        case 'ExternalUniquenessConstraint': {
          if (!roles.length) break;
          model.constraints.push({
            kind: 'uniqueness',
            id,
            name,
            roles,
            isPreferredIdentifier: bool(rc['@IsPreferredUniqueness']) || undefined,
            modality,
          });
          break;
        }
        case 'MandatoryConstraint': {
          if (!roles.length) break;
          model.constraints.push({ kind: 'mandatory', id, name, roles, modality });
          break;
        }
        case 'FrequencyConstraint': {
          if (!roles.length) break;
          const max = num(rc['@MaximumFrequencyCount']) ?? 0;
          model.constraints.push({
            kind: 'frequency',
            id,
            name,
            roles,
            min: num(rc['@MinimumFrequencyCount']) ?? 1,
            max: max > 0 ? max : null,
            modality,
          });
          break;
        }
        case 'RingConstraint': {
          if (roles.length < 2) break;
          model.constraints.push({
            kind: 'ring',
            id,
            name,
            roles: [roles[0], roles[1]],
            types: ringTypes(str(rc['@RingConstraintType'])),
            modality,
          });
          break;
        }
        case 'SubsetConstraint':
        case 'JoinSubsetConstraint':
        case 'ExclusionConstraint':
        case 'EqualityConstraint': {
          const sequences = roleSequences(rc, roles);
          if (sequences.length < 2) {
            warnings.push(`${type} "${name ?? id}" had fewer than two role sequences and was skipped.`);
            break;
          }
          model.constraints.push({
            kind: type.includes('Subset') ? 'subset' : type === 'ExclusionConstraint' ? 'exclusion' : 'equality',
            id,
            name,
            roleSequences: sequences,
            modality,
          });
          break;
        }
        case 'RoleValueConstraint': {
          const ranges = valueConstraintRanges(rc);
          if (!roles.length || !ranges.length) break;
          model.constraints.push({ kind: 'value', id, name, roleId: roles[0], ranges, modality });
          break;
        }
        case 'CardinalityConstraint': {
          if (!roles.length) break;
          const cardinality = num(rc['@Cardinality']) ?? 0;
          const atMost = str(rc['@CardinalityRangeType']) !== 'GreaterThanOrEqual';
          model.constraints.push({
            kind: 'cardinality',
            id,
            name,
            roleId: roles[0],
            min: atMost ? 0 : cardinality,
            max: atMost ? cardinality : null,
            modality,
          });
          break;
        }
        default:
          warnings.push(`Role constraint type "${type}" is not supported and was skipped.`);
      }
    }
  }
}

/** Role ids in `SequenceNr` order. */
function constraintRoleIds(rc: XmlNode): Id[] {
  const out: { id: Id; seq: number }[] = [];
  for (const container of list(rc.RoleConstraintRoles)) {
    for (const node of list((container as XmlNode).RoleConstraintRole)) {
      const id = str((node as XmlNode)['@RoleId']);
      if (id) out.push({ id, seq: num((node as XmlNode)['@SequenceNr']) ?? 0 });
    }
  }
  return out.sort((a, b) => a.seq - b.seq).map((r) => r.id);
}

/**
 * Set-comparison constraints carry one `RoleConstraintArgument` per role
 * sequence. When the arguments are absent the flat role list is split in half,
 * which is what a two-sequence constraint of equal arity amounts to.
 */
function roleSequences(rc: XmlNode, flat: Id[]): Id[][] {
  const sequences: Id[][] = [];
  for (const container of list(rc.Argument)) {
    const args = list((container as XmlNode).RoleConstraintArgument).slice();
    args.sort((a, b) => (num((a as XmlNode)['@SequenceNr']) ?? 0) - (num((b as XmlNode)['@SequenceNr']) ?? 0));
    for (const argNode of args) {
      const ids: Id[] = [];
      for (const roleNode of list((argNode as XmlNode).Role)) {
        for (const ref of list((roleNode as XmlNode).RoleReference)) {
          const id = str((ref as XmlNode)['@RoleId']);
          if (id) ids.push(id);
        }
      }
      if (ids.length) sequences.push(ids);
    }
  }
  if (sequences.length >= 2) return sequences;
  if (flat.length >= 2 && flat.length % 2 === 0) {
    const half = flat.length / 2;
    return [flat.slice(0, half), flat.slice(half)];
  }
  return sequences;
}

function importNotesAndSynonyms(ormModel: XmlNode, model: OrmModel): void {
  const byId = new Map<Id, ObjectType | FactType>();
  for (const ot of model.objectTypes) byId.set(ot.id, ot);
  for (const ft of model.factTypes) byId.set(ft.id, ft);

  for (const container of list(ormModel.ModelNotes)) {
    for (const node of list((container as XmlNode).ModelNote)) {
      const text = textOf((node as XmlNode).Note);
      const target = str((node as XmlNode)['@JoinedObjectId']);
      if (!text) continue;
      const element = target ? byId.get(target) : undefined;
      if (element) element.note = element.note ? `${element.note}\n${text}` : text;
      else model.note = model.note ? `${model.note}\n${text}` : text;
    }
  }

  for (const container of list(ormModel.Synonyms)) {
    for (const node of list((container as XmlNode).Synonym)) {
      const target = str((node as XmlNode)['@ModelElementId']);
      const synonym = str((node as XmlNode)['@Synonym']);
      if (!target || !synonym) continue;
      const element = byId.get(target);
      if (!element) continue;
      element.meta = element.meta ?? {};
      element.meta.synonyms = [...(element.meta.synonyms ?? []), synonym];
    }
  }
}

function importDiagram(root: XmlNode, model: OrmModel, warnings: string[]): void {
  const diagram = (first(root.FBMDiagram) ?? first(root.ORMDiagram)) as XmlNode | undefined;
  if (!diagram) return;
  const pages = list(diagram.Page);
  if (pages.length > 1) {
    warnings.push(`The document has ${pages.length} diagram pages; only the first was kept.`);
  }
  const page = pages[0] as XmlNode | undefined;
  if (!page) return;
  const name = str(page['@Name']);
  if (name) model.diagram.name = name;
  const language = str(page['@Language']);
  // FBM's page language names the notation ("ORMModel"), not a natural language,
  // so it is only carried when it looks like a BCP 47 tag.
  if (language && /^[a-z]{2}(-[A-Za-z0-9]+)*$/.test(language)) model.lang = language;

  // A page draws more than the model holds shapes for — reading text, fact type
  // names, role names and constraint markers each get an instance of their own.
  // Taking all of them made a shape out of every one, and let an invisible
  // marker at the origin overwrite the position of the thing it belongs to.
  const objectTypesByName = new Map<string, Id>();
  for (const ot of model.objectTypes) objectTypesByName.set(ot.name, ot.id);
  const factTypesByName = new Map<string, Id>();
  for (const ft of model.factTypes) factTypesByName.set(fbmFactTypeName(ft, model), ft.id);

  for (const wrapper of list(page.ConceptInstance)) {
    for (const node of list((wrapper as XmlNode).ConceptInstance)) {
      const shape = node as XmlNode;
      const symbol = str(shape['@Symbol']);
      if (!symbol) continue;
      const conceptType = str(shape['@ConceptType']);
      let id: Id | undefined;
      if (conceptType === 'ValueType' || conceptType === 'EntityType') {
        id = objectTypesByName.get(symbol);
      } else if (conceptType === 'FactType') {
        id = factTypesByName.get(symbol);
      } else if (!conceptType) {
        // A page that names no concept type is matched by name alone.
        id = objectTypesByName.get(symbol) ?? factTypesByName.get(symbol);
      }
      if (!id) continue;
      const x = num(shape['@X']);
      const y = num(shape['@Y']);
      if (x === undefined || y === undefined) continue;
      const w = num(shape['@Width']);
      const h = num(shape['@Height']);
      model.diagram.shapes[id] = {
        x,
        y,
        ...(w && w > 0 ? { w } : {}),
        ...(h && h > 0 ? { h } : {}),
        ...(bool(shape['@Visible']) === false ? { hidden: true } : {}),
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

export function exportFbmFile(model: OrmModel): ExportResult {
  const warnings: string[] = [];
  const index = indexModel(model);

  const mandatoryRoles = new Set<Id>();
  for (const c of model.constraints) {
    if (c.kind === 'mandatory' && c.roles.length === 1) mandatoryRoles.add(c.roles[0]);
    else if (c.kind === 'mandatory') {
      warnings.push(
        `Disjunctive mandatory constraint "${c.name ?? c.id}" spans ${c.roles.length} roles; FBM records mandatory per role, so it was written as a role constraint instead.`,
      );
    }
  }

  const objectifiedBy = new Map<Id, Id>();
  for (const ot of model.objectTypes) {
    if (ot.objectifiedFactTypeId) objectifiedBy.set(ot.objectifiedFactTypeId, ot.id);
  }

  const valueTypes = model.objectTypes.filter((o) => o.kind === 'value');
  const entityTypes = model.objectTypes.filter((o) => o.kind === 'entity');

  const document = {
    '?xml': { '@version': '1.0', '@encoding': 'utf-8' },
    Model: {
      '@XSDVersionNr': FBM_XSD_VERSION,
      ORMModel: {
        '@ModelId': model.meta?.guid ?? pascalCase(model.name),
        '@Name': model.name,
        '@CoreVersionNumber': '2.6',
        ValueTypes: { ValueType: valueTypes.map((ot) => valueTypeNode(ot, model)) },
        EntityTypes: { EntityType: entityTypes.map((ot) => entityTypeNode(ot, model)) },
        FactTypes: {
          FactType: model.factTypes.map((ft) => factTypeNode(ft, model, mandatoryRoles, objectifiedBy)),
        },
        RoleConstraints: { RoleConstraint: roleConstraintNodes(model, index, warnings) },
        ModelNotes: { ModelNote: noteNodes(model) },
        Synonyms: { Synonym: synonymNodes(model) },
      },
      ORMDiagram: { Page: pageNode(model) },
    },
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: true,
    // Without this the builder writes `Mandatory` instead of `Mandatory="true"`,
    // which the XSD rejects and a re-import reads as absent.
    suppressBooleanAttributes: false,
  });
  return { text: `${(builder.build(document) as string).trim()}\n`, warnings };
}

function valueTypeNode(ot: ObjectType, model: OrmModel): XmlNode {
  const constraint = model.constraints.find(
    (c): c is Extract<Constraint, { kind: 'value' }> => c.kind === 'value' && c.objectTypeId === ot.id,
  );
  return {
    '@Id': ot.id,
    '@GUID': ot.meta?.guid ?? '',
    '@Name': ot.name,
    '@DBName': ot.hints?.relational?.tableName ?? '',
    '@DataType': dataTypeToNorma(ot.dataType, ot.dataTypeLength),
    '@DataTypePrecision': String(ot.dataTypeScale ?? 0),
    '@DataTypeLength': String(ot.dataTypeLength ?? 0),
    '@IsIndependent': String(!!ot.isIndependent),
    '@IsMDAModelElement': 'false',
    '@LongDescription': ot.meta?.description ?? ot.note ?? '',
    '@ShortDescription': ot.meta?.shortDescription ?? '',
    Instance: ot.population?.length ? { string: ot.population.map(String) } : {},
    ValueConstraint: constraint ? { string: rangeStrings(constraint.ranges) } : {},
    SubtypeRelationships: {},
  };
}

function entityTypeNode(ot: ObjectType, model: OrmModel): XmlNode {
  const parents = model.subtypeRelations.filter((s) => s.subtypeId === ot.id);
  return {
    '@Id': ot.id,
    '@GUID': ot.meta?.guid ?? '',
    '@Name': ot.name,
    '@DBName': ot.hints?.relational?.tableName ?? '',
    '@ReferenceMode': ot.refMode ? `.${ot.refMode}` : '',
    '@ReferenceModeValueTypeId': '',
    '@ReferenceSchemeRoleConstraintId': '',
    '@IsObjectifyingEntityType': String(!!ot.objectifiedFactTypeId),
    '@HideReferenceMode': 'false',
    '@IsIndependent': String(!!ot.isIndependent),
    '@IsPersonal': String(!!ot.isPersonal),
    '@IsAbsorbed': 'false',
    '@IsDerived': 'false',
    '@IsMDAModelElement': 'false',
    '@DerivationText': '',
    '@LongDescription': ot.meta?.description ?? ot.note ?? '',
    '@ShortDescription': ot.meta?.shortDescription ?? '',
    GraphLabel: ot.hints?.graph?.label ? { string: ot.hints.graph.label } : {},
    Instance: ot.population?.length ? { string: ot.population.map(String) } : {},
    SubtypeRelationships: parents.length
      ? {
          SubtypeRelationship: parents.map((s) => ({
            '@ParentEntityTypeId': s.supertypeId,
            '@SubtypingFactTypeId': s.id,
          })),
        }
      : {},
  };
}

/**
 * The name a fact type is written under. The page's `Symbol` has to agree with
 * it, because that is how a reader matches a shape to what it draws.
 */
function fbmFactTypeName(ft: FactType, model: OrmModel): string {
  const reading = primaryReading(ft);
  return pascalCase(reading ? readingName(ft, reading, model) : ft.id);
}

function factTypeNode(
  ft: FactType,
  model: OrmModel,
  mandatoryRoles: Set<Id>,
  objectifiedBy: Map<Id, Id>,
): XmlNode {
  return {
    '@Id': ft.id,
    '@GUID': ft.meta?.guid ?? '',
    '@Name': fbmFactTypeName(ft, model),
    '@DBName': ft.hints?.relational?.tableName ?? '',
    '@ObjectifyingEntityTypeId': objectifiedBy.get(ft.id) ?? '',
    '@IsObjectified': String(objectifiedBy.has(ft.id)),
    '@IsSubtypeRelationshipFactType': 'false',
    '@IsPreferredReferenceSchemeFT': 'false',
    '@IsLinkFactType': 'false',
    '@IsMDAModelElement': 'false',
    '@IsDerived': String(!!ft.isDerived),
    '@IsStored': String(!!ft.isStored),
    '@DerivationText': ft.derivationRule ?? '',
    '@IsIndependent': 'false',
    '@IsSubtypeStateControlling': 'false',
    '@StoreFactCoordinates': 'false',
    '@LongDescription': ft.meta?.description ?? ft.note ?? '',
    '@ShortDescription': ft.meta?.shortDescription ?? '',
    GraphLabel: ft.hints?.graph?.label ? { string: ft.hints.graph.label } : {},
    RoleGroup: {
      Role: ft.roles.map((role, position) => ({
        '@Id': role.id,
        '@Name': role.name ?? '',
        '@SequenceNr': String(position + 1),
        '@Mandatory': String(mandatoryRoles.has(role.id)),
        '@JoinedObjectTypeId': role.objectTypeId ?? '',
        ValueConstraint: {},
      })),
    },
    Facts: ft.population?.length
      ? {
          Fact: ft.population.map((instance, row) => ({
            '@Id': instance.id ?? `${ft.id}_f${row + 1}`,
            Data: {
              FactData: ft.roles
                .map((role, position) => ({ role, value: instance.values[position] }))
                .filter((cell) => cell.value !== null && cell.value !== undefined)
                .map((cell) => ({ '@RoleId': cell.role.id, Value: String(cell.value) })),
            },
          })),
        }
      : {},
    FactTypeReadings: { FactTypeReading: ft.readings.map(readingNode) },
    SubtypeRelationships: {},
  };
}

/** A fact type's FBM name is conventionally its reading with the players in it. */
function readingName(ft: FactType, reading: Reading, model: OrmModel): string {
  return reading.text.replace(/\{(\d+)\}/g, (match, digits: string) => {
    const roleId = reading.roleOrder[Number(digits)];
    const role = ft.roles.find((r) => r.id === roleId);
    const player = model.objectTypes.find((o) => o.id === role?.objectTypeId);
    return player ? player.name : match;
  });
}

/**
 * Splits `{0} works for {1}` back into predicate parts: each placeholder starts
 * a part, and the text that follows it becomes that part's text.
 */
function readingNode(reading: Reading): XmlNode {
  const parts: XmlNode[] = [];
  const tokens = reading.text.split(/(\{\d+\})/g);
  let front = '';
  let current: XmlNode | undefined;

  for (const token of tokens) {
    if (!token) continue;
    const placeholder = /^\{(\d+)\}$/.exec(token);
    if (placeholder) {
      const roleId = reading.roleOrder[Number(placeholder[1])];
      if (!roleId) continue;
      current = {
        '@SequenceNr': String(parts.length + 1),
        '@Role_Id': roleId,
        '@PreboundReadingText': '',
        '@PostboundReadingText': '',
        PredicatePartText: '',
      };
      parts.push(current);
    } else if (current) {
      current.PredicatePartText = token.trim();
    } else {
      front = token.trim();
    }
  }

  return {
    '@Id': reading.id,
    '@FrontReadingText': front,
    '@FollowingReadingText': '',
    PredicateParts: { PredicatePart: parts },
  };
}

function roleConstraintNodes(
  model: OrmModel,
  index: ReturnType<typeof indexModel>,
  warnings: string[],
): XmlNode[] {
  const nodes: XmlNode[] = [];
  for (const c of model.constraints) {
    // Simple mandatory and object-type value constraints are written on the
    // role and the value type respectively, so they are not repeated here.
    if (c.kind === 'mandatory' && c.roles.length === 1) continue;
    if (c.kind === 'value' && c.objectTypeId) continue;
    if (c.kind === 'subtypeSet') {
      warnings.push(
        `Subtype set constraint "${c.name ?? c.id}" has no FBM counterpart and was dropped.`,
      );
      continue;
    }

    const type = fbmConstraintType(c, model, index);
    if (!type) continue;
    const roles = constraintRoles(c);
    const node: XmlNode = {
      '@Id': c.id,
      '@GUID': c.meta?.guid ?? '',
      '@Name': c.name ?? c.id,
      '@RoleConstraintType': type,
      '@RingConstraintType': c.kind === 'ring' ? ringConstraintType(c.types) : 'None',
      '@IsPreferredUniqueness': String(c.kind === 'uniqueness' && !!c.isPreferredIdentifier),
      '@IsDeontic': String(c.modality === 'deontic'),
      '@IsMDAModelElement': 'false',
      '@MinimumFrequencyCount': String(c.kind === 'frequency' ? c.min : 0),
      '@MaximumFrequencyCount': String(c.kind === 'frequency' ? (c.max ?? 0) : 0),
      '@Cardinality': String(c.kind === 'cardinality' ? (c.max ?? c.min) : 0),
      '@CardinalityRangeType': 'LessThanOrEqual',
      '@LongDescription': c.meta?.description ?? c.note ?? '',
      '@ShortDescription': c.meta?.shortDescription ?? '',
      RoleConstraintRoles: {
        RoleConstraintRole: roles.map((roleId, position) => ({
          '@RoleId': roleId,
          '@SequenceNr': String(position + 1),
          '@IsEntry': 'false',
          '@IsExit': 'false',
          '@ArgumentId': '',
          '@ArgumentSequenceNr': '0',
        })),
      },
      Argument:
        c.kind === 'subset' || c.kind === 'exclusion' || c.kind === 'equality'
          ? {
              RoleConstraintArgument: c.roleSequences.map((sequence, position) => ({
                '@SequenceNr': String(position + 1),
                Role: { RoleReference: sequence.map((roleId) => ({ '@RoleId': roleId })) },
                JoinPath: {
                  '@JoinPathError': 'None',
                  RolePath: { RoleReference: sequence.map((roleId) => ({ '@RoleId': roleId })) },
                },
              })),
            }
          : {},
      ValueConstraint: c.kind === 'value' ? { string: rangeStrings(c.ranges) } : {},
    };
    nodes.push(node);
  }
  return nodes;
}

function fbmConstraintType(
  c: Constraint,
  model: OrmModel,
  index: ReturnType<typeof indexModel>,
): string | undefined {
  switch (c.kind) {
    case 'uniqueness': {
      const owners = new Set(c.roles.map((r) => index.roleOwner.get(r)?.id));
      return owners.size === 1 && !owners.has(undefined)
        ? 'InternalUniquenessConstraint'
        : 'ExternalUniquenessConstraint';
    }
    case 'mandatory': return 'MandatoryConstraint';
    case 'frequency': return 'FrequencyConstraint';
    case 'ring': return 'RingConstraint';
    case 'subset': return 'SubsetConstraint';
    case 'exclusion': return 'ExclusionConstraint';
    case 'equality': return 'EqualityConstraint';
    case 'value': return 'RoleValueConstraint';
    case 'cardinality': return 'CardinalityConstraint';
    default: {
      void model;
      return undefined;
    }
  }
}

function noteNodes(model: OrmModel): XmlNode[] {
  const nodes: XmlNode[] = [];
  for (const element of [...model.objectTypes, ...model.factTypes]) {
    if (!element.note) continue;
    nodes.push({ '@Id': newId('note'), '@JoinedObjectId': element.id, '@IsMDAModelElement': 'false', Note: element.note });
  }
  return nodes;
}

function synonymNodes(model: OrmModel): XmlNode[] {
  const nodes: XmlNode[] = [];
  for (const element of [...model.objectTypes, ...model.factTypes]) {
    for (const synonym of element.meta?.synonyms ?? []) {
      nodes.push({ '@ModelElementId': element.id, '@Synonym': synonym });
    }
  }
  return nodes;
}

/**
 * A page instance names what it draws by symbol and concept type. A value type
 * is `ValueType` and not `EntityType`; an objectified type is drawn as the
 * entity it is, which is what Boston writes beside the fact type's own instance.
 */
function conceptInstanceOf(model: OrmModel): Map<Id, { symbol: string; conceptType: string }> {
  const byId = new Map<Id, { symbol: string; conceptType: string }>();
  for (const ot of model.objectTypes) {
    byId.set(ot.id, { symbol: ot.name, conceptType: ot.kind === 'value' ? 'ValueType' : 'EntityType' });
  }
  for (const ft of model.factTypes) {
    byId.set(ft.id, { symbol: fbmFactTypeName(ft, model), conceptType: 'FactType' });
  }
  return byId;
}

function pageNode(model: OrmModel): XmlNode {
  const byId = conceptInstanceOf(model);
  const instances: XmlNode[] = [];
  let n = 0;
  for (const [id, shape] of Object.entries(model.diagram.shapes)) {
    const concept = byId.get(id);
    // A shape for something the model no longer holds has nothing to name.
    if (!concept) continue;
    n += 1;
    instances.push({
      '@Symbol': concept.symbol,
      '@ConceptType': concept.conceptType,
      '@RoleId': 'NotUsed',
      '@X': String(Math.round(shape.x)),
      '@Y': String(Math.round(shape.y)),
      '@Width': String(Math.round(shape.w ?? 0)),
      '@Height': String(Math.round(shape.h ?? 0)),
      '@Orientation': shape.orientation === 'vertical' ? '1' : '0',
      '@Visible': String(!shape.hidden),
      '@InstanceNumber': String(n),
    });
  }
  return {
    '@Id': newId('page'),
    '@Name': model.diagram.name ?? model.name,
    '@Language': 'ORMModel',
    '@IsCoreModelPage': 'false',
    ConceptInstance: { ConceptInstance: instances },
  };
}

/* -------------------------------------------------------------------------- */
/* Ring types and value ranges                                                 */
/* -------------------------------------------------------------------------- */

const RING_NAMES: RingType[] = [
  'purelyReflexive', 'irreflexive', 'reflexive', 'symmetric', 'asymmetric',
  'antisymmetric', 'strictlyIntransitive', 'intransitive', 'transitive', 'acyclic',
];

/** FBM concatenates ring types: `AsymmetricIntransitive` is two of them. */
function ringTypes(value: string | undefined): RingType[] {
  if (!value || value === 'None') return ['irreflexive'];
  const found: RingType[] = [];
  let rest = value;
  // Longest names first, so `strictlyIntransitive` wins over `intransitive`.
  const ordered = [...RING_NAMES].sort((a, b) => b.length - a.length);
  while (rest.length) {
    const match = ordered.find((name) => rest.toLowerCase().startsWith(name.toLowerCase()));
    if (!match) break;
    found.push(match);
    rest = rest.slice(match.length);
  }
  return found.length ? found : ['irreflexive'];
}

function ringConstraintType(types: RingType[]): string {
  return types.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join('') || 'None';
}

function valueConstraintRanges(node: XmlNode): ValueRange[] {
  const ranges: ValueRange[] = [];
  for (const container of list(node.ValueConstraint)) {
    for (const value of list((container as XmlNode).string)) {
      const text = typeof value === 'string' ? value : str((value as XmlNode)?.['#text']);
      if (text === undefined || text === '') continue;
      // FBM writes ranges as `min..max`; anything else is a discrete value.
      const range = /^(.+?)\.\.(.+)$/.exec(text);
      if (range) ranges.push({ min: range[1].trim(), max: range[2].trim() });
      else ranges.push({ value: text });
    }
  }
  return ranges;
}

function rangeStrings(ranges: ValueRange[]): string[] {
  return ranges.map((r) =>
    r.value !== undefined ? String(r.value) : `${r.min ?? ''}..${r.max ?? ''}`,
  );
}

/* -------------------------------------------------------------------------- */
/* XML helpers                                                                 */
/* -------------------------------------------------------------------------- */

function applyMeta(element: { meta?: Meta; note?: string }, node: XmlNode): void {
  const guid = nonEmpty(str(node['@GUID']));
  const description = nonEmpty(str(node['@LongDescription']));
  const shortDescription = nonEmpty(str(node['@ShortDescription']));
  if (!guid && !description && !shortDescription) return;
  element.meta = {
    ...(guid ? { guid } : {}),
    ...(shortDescription ? { shortDescription } : {}),
    ...(description ? { description } : {}),
  };
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

function num(value: unknown): number | undefined {
  const text = str(value);
  if (text === undefined || text.trim() === '') return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(value: unknown): boolean {
  return str(value)?.toLowerCase() === 'true';
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return nonEmpty(value);
  const node = first(value) as XmlNode | undefined;
  return node ? nonEmpty(str(node['#text'])) : undefined;
}

function firstString(value: unknown): string | undefined {
  const node = first(value) as XmlNode | undefined;
  if (!node) return undefined;
  if (typeof node === 'string') return nonEmpty(node);
  return nonEmpty(str(first(node.string)));
}
