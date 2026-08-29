import { XMLParser } from 'fast-xml-parser';
import {
  DataType,
  FactType,
  Id,
  ObjectType,
  OrmModel,
  Reading,
  RingType,
  Role,
  Shape,
  SubtypeRelation,
  ValueRange,
} from '../model/types.js';
import { emptyModel, newId } from '../model/model.js';

/** NORMA stores diagram geometry in inches; VS Code draws in CSS pixels. */
const PIXELS_PER_INCH = 96;

export interface ImportResult {
  model: OrmModel;
  warnings: string[];
}

type XmlNode = Record<string, unknown>;

/**
 * Reads a NORMA / ORM2 `.orm` XML file into the native model. The importer is
 * deliberately tolerant: unknown elements are skipped and reported as warnings
 * rather than failing the whole import.
 */
export function importNormaFile(xml: string): ImportResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    removeNSPrefix: true,
    parseAttributeValue: false,
    trimValues: true,
  });
  const document = parser.parse(xml) as XmlNode;
  const root = (document.ORM2 ?? document) as XmlNode;
  const ormModel = first(root.ORMModel) as XmlNode | undefined;
  if (!ormModel) {
    throw new Error('Not a NORMA ORM file: no <ORMModel> element was found.');
  }

  const warnings: string[] = [];
  const model = emptyModel(str(ormModel['@Name']) ?? 'Imported Model');

  const dataTypes = collectDataTypes(ormModel);
  const objects = (first(ormModel.Objects) ?? {}) as XmlNode;
  const facts = (first(ormModel.Facts) ?? {}) as XmlNode;
  const constraints = (first(ormModel.Constraints) ?? {}) as XmlNode;

  importObjectTypes(objects, dataTypes, model, warnings);
  importFactTypes(facts, model, warnings);
  importConstraints(constraints, model, warnings);
  importValueRestrictions(objects, model);
  importDiagram(root, model);

  return { model, warnings };
}

/* -------------------------------------------------------------------------- */
/* Objects                                                                     */
/* -------------------------------------------------------------------------- */

function importObjectTypes(
  objects: XmlNode,
  dataTypes: Map<Id, DataType>,
  model: OrmModel,
  warnings: string[],
): void {
  for (const node of list(objects.EntityType)) {
    model.objectTypes.push(baseObjectType(node, 'entity', dataTypes));
  }
  for (const node of list(objects.ValueType)) {
    model.objectTypes.push(baseObjectType(node, 'value', dataTypes));
  }
  for (const node of list(objects.ObjectifiedType)) {
    const ot = baseObjectType(node, 'entity', dataTypes);
    const nested = first(node.NestedPredicate) as XmlNode | undefined;
    const ref = nested ? str(nested['@ref']) : undefined;
    if (ref) {
      ot.objectifiedFactTypeId = ref;
      ot.isImplicitObjectification = str(nested?.['@IsImplied']) === 'true';
    } else {
      warnings.push(`Objectified type "${ot.name}" has no nested predicate reference.`);
    }
    model.objectTypes.push(ot);
  }
}

function baseObjectType(node: XmlNode, kind: 'entity' | 'value', dataTypes: Map<Id, DataType>): ObjectType {
  const conceptual = first(node.ConceptualDataType) as XmlNode | undefined;
  const dataTypeRef = conceptual ? str(conceptual['@ref']) : undefined;
  const length = conceptual ? num(conceptual['@Length']) : undefined;
  const scale = conceptual ? num(conceptual['@Scale']) : undefined;
  const refMode = str(node['@_ReferenceMode']);
  return {
    id: str(node['@id']) ?? newId('ot'),
    name: str(node['@Name']) ?? 'Unnamed',
    kind,
    refMode: refMode && refMode.length ? refMode : undefined,
    dataType: dataTypeRef ? dataTypes.get(dataTypeRef) : undefined,
    dataTypeLength: length && length > 0 ? length : undefined,
    dataTypeScale: scale && scale > 0 ? scale : undefined,
    isIndependent: str(node['@IsIndependent']) === 'true' || undefined,
    isPersonal: str(node['@IsPersonal']) === 'true' || undefined,
    note: readNote(node),
  };
}

function collectDataTypes(ormModel: XmlNode): Map<Id, DataType> {
  const map = new Map<Id, DataType>();
  const container = first(ormModel.DataTypes) as XmlNode | undefined;
  if (!container) return map;
  for (const [tag, value] of Object.entries(container)) {
    if (tag.startsWith('@')) continue;
    for (const node of list(value)) {
      const id = str((node as XmlNode)['@id']);
      if (id) map.set(id, normaDataType(tag));
    }
  }
  return map;
}

function normaDataType(tag: string): DataType {
  const name = tag.toLowerCase();
  if (name.includes('autocounter') || name.includes('rowid')) return 'autoCounter';
  if (name.includes('money')) return 'money';
  if (name.includes('decimal')) return 'decimal';
  if (name.includes('floatingpoint')) return 'float';
  if (name.includes('integer') || name.includes('numeric')) return 'integer';
  if (name.includes('dateandtime') || name.includes('timestamp')) return 'dateTime';
  if (name.includes('datetemporal')) return 'date';
  if (name.includes('timetemporal')) return 'time';
  if (name.includes('logical')) return 'boolean';
  if (name.includes('largelengthtext')) return 'text';
  if (name.includes('text')) return 'string';
  if (name.includes('raw') || name.includes('picture') || name.includes('oleobject')) return 'binary';
  if (name.includes('uuid') || name.includes('guid') || name.includes('objectid')) return 'guid';
  return 'string';
}

/* -------------------------------------------------------------------------- */
/* Facts                                                                       */
/* -------------------------------------------------------------------------- */

function importFactTypes(facts: XmlNode, model: OrmModel, warnings: string[]): void {
  for (const node of list(facts.Fact)) {
    const factType = importFact(node, warnings);
    if (factType) model.factTypes.push(factType);
  }
  for (const node of list(facts.ImpliedFact)) {
    const factType = importFact(node, warnings);
    if (factType) model.factTypes.push(factType);
  }
  for (const node of list(facts.SubtypeFact)) {
    const relation = importSubtypeFact(node);
    if (relation) model.subtypeRelations.push(relation);
    else warnings.push('A subtype fact could not be read (missing subtype or supertype role player).');
  }
}

function importFact(node: XmlNode, warnings: string[]): FactType | undefined {
  const id = str(node['@id']) ?? newId('ft');
  const rolesNode = first(node.FactRoles) as XmlNode | undefined;
  const roles: Role[] = list(rolesNode?.Role).map((roleNode) => {
    const player = first((roleNode as XmlNode).RolePlayer) as XmlNode | undefined;
    return {
      id: str((roleNode as XmlNode)['@id']) ?? newId('r'),
      objectTypeId: player ? str(player['@ref']) ?? null : null,
      name: nonEmpty(str((roleNode as XmlNode)['@Name'])),
    };
  });
  if (!roles.length) {
    warnings.push(`Fact type ${id} has no roles and was skipped.`);
    return undefined;
  }

  const readings: Reading[] = [];
  const orders = first(node.ReadingOrders) as XmlNode | undefined;
  for (const order of list(orders?.ReadingOrder)) {
    const sequence = first((order as XmlNode).RoleSequence) as XmlNode | undefined;
    const roleOrder = list(sequence?.Role)
      .map((r) => str((r as XmlNode)['@ref']))
      .filter((r): r is string => !!r);
    const readingsNode = first((order as XmlNode).Readings) as XmlNode | undefined;
    for (const reading of list(readingsNode?.Reading)) {
      const data = (reading as XmlNode).Data;
      const text = typeof data === 'string' ? data : str((data as XmlNode | undefined)?.['#text']);
      if (!text) continue;
      readings.push({
        id: str((reading as XmlNode)['@id']) ?? newId('rd'),
        roleOrder: roleOrder.length ? roleOrder : roles.map((r) => r.id),
        text,
        isPrimary: readings.length === 0 || undefined,
      });
    }
  }
  if (!readings.length) {
    readings.push({
      id: newId('rd'),
      roleOrder: roles.map((r) => r.id),
      text: roles.map((_, position) => `{${position}}`).join(' ... '),
      isPrimary: true,
    });
    warnings.push(`Fact type ${id} had no reading; a placeholder reading was generated.`);
  }

  return { id, roles, readings, note: readNote(node) };
}

function importSubtypeFact(node: XmlNode): SubtypeRelation | undefined {
  const rolesNode = first(node.FactRoles) as XmlNode | undefined;
  const subtypeRole = first(rolesNode?.SubtypeMetaRole) as XmlNode | undefined;
  const supertypeRole = first(rolesNode?.SupertypeMetaRole) as XmlNode | undefined;
  const subtypeId = str((first(subtypeRole?.RolePlayer) as XmlNode | undefined)?.['@ref']);
  const supertypeId = str((first(supertypeRole?.RolePlayer) as XmlNode | undefined)?.['@ref']);
  if (!subtypeId || !supertypeId) return undefined;
  return {
    id: str(node['@id']) ?? newId('st'),
    subtypeId,
    supertypeId,
    isPreferredIdentificationPath: str(node['@IsPrimary']) === 'true' || undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Constraints                                                                 */
/* -------------------------------------------------------------------------- */

function importConstraints(container: XmlNode, model: OrmModel, warnings: string[]): void {
  for (const node of list(container.UniquenessConstraint)) {
    const roles = roleSequence(node as XmlNode);
    if (!roles.length) continue;
    const preferredFor = first((node as XmlNode).PreferredIdentifierFor) as XmlNode | undefined;
    model.constraints.push({
      kind: 'uniqueness',
      id: str((node as XmlNode)['@id']) ?? newId('uc'),
      name: nonEmpty(str((node as XmlNode)['@Name'])),
      roles,
      isPreferredIdentifier: preferredFor ? true : undefined,
      modality: modality(node as XmlNode),
    });
  }

  for (const node of list(container.MandatoryConstraint)) {
    const roles = roleSequence(node as XmlNode);
    if (!roles.length) continue;
    // NORMA models implied mandatory constraints for objectification; keep them flagged.
    model.constraints.push({
      kind: 'mandatory',
      id: str((node as XmlNode)['@id']) ?? newId('mc'),
      name: nonEmpty(str((node as XmlNode)['@Name'])),
      roles,
      isImplied: str((node as XmlNode)['@IsImplied']) === 'true' || undefined,
      modality: modality(node as XmlNode),
    });
  }

  for (const node of list(container.FrequencyConstraint)) {
    const roles = roleSequence(node as XmlNode);
    if (!roles.length) continue;
    const max = num((node as XmlNode)['@MaxFrequency']);
    model.constraints.push({
      kind: 'frequency',
      id: str((node as XmlNode)['@id']) ?? newId('fc'),
      roles,
      min: num((node as XmlNode)['@MinFrequency']) ?? 1,
      max: max && max > 0 ? max : null,
      modality: modality(node as XmlNode),
    });
  }

  for (const node of list(container.RingConstraint)) {
    const roles = roleSequence(node as XmlNode);
    if (roles.length < 2) continue;
    model.constraints.push({
      kind: 'ring',
      id: str((node as XmlNode)['@id']) ?? newId('rc'),
      roles: [roles[0], roles[1]],
      types: ringTypes(str((node as XmlNode)['@Type'])),
      modality: modality(node as XmlNode),
    });
  }

  const setKinds: [string, 'subset' | 'exclusion' | 'equality'][] = [
    ['SubsetConstraint', 'subset'],
    ['ExclusionConstraint', 'exclusion'],
    ['EqualityConstraint', 'equality'],
  ];
  for (const [tag, kind] of setKinds) {
    for (const node of list(container[tag])) {
      const sequencesNode = first((node as XmlNode).RoleSequences) as XmlNode | undefined;
      const sequences = list(sequencesNode?.RoleSequence)
        .map((seq) =>
          list((seq as XmlNode).Role)
            .map((r) => str((r as XmlNode)['@ref']))
            .filter((r): r is string => !!r),
        )
        .filter((seq) => seq.length > 0);
      if (sequences.length < 2) {
        warnings.push(`${tag} ${str((node as XmlNode)['@id']) ?? ''} has fewer than two role sequences and was skipped.`);
        continue;
      }
      model.constraints.push({
        kind,
        id: str((node as XmlNode)['@id']) ?? newId('sc'),
        name: nonEmpty(str((node as XmlNode)['@Name'])),
        roleSequences: sequences,
        modality: modality(node as XmlNode),
      });
    }
  }

  for (const tag of ['ExclusiveOrConstraint', 'ExclusiveOrExclusionConstraint']) {
    if (list(container[tag]).length) {
      warnings.push(`${tag} elements are represented as separate mandatory and exclusion constraints.`);
    }
  }
}

function importValueRestrictions(objects: XmlNode, model: OrmModel): void {
  for (const tag of ['EntityType', 'ValueType', 'ObjectifiedType']) {
    for (const node of list(objects[tag])) {
      const restriction = first((node as XmlNode).ValueRestriction) as XmlNode | undefined;
      if (!restriction) continue;
      for (const key of ['ValueConstraint', 'ValueTypeValueConstraint', 'RoleValueConstraint']) {
        for (const constraintNode of list(restriction[key])) {
          const ranges = valueRanges(constraintNode as XmlNode);
          if (!ranges.length) continue;
          model.constraints.push({
            kind: 'value',
            id: str((constraintNode as XmlNode)['@id']) ?? newId('vc'),
            objectTypeId: str((node as XmlNode)['@id']),
            ranges,
            modality: modality(constraintNode as XmlNode),
          });
        }
      }
    }
  }
}

function valueRanges(node: XmlNode): ValueRange[] {
  const container = first(node.ValueRanges) as XmlNode | undefined;
  return list(container?.ValueRange).flatMap((rangeNode) => {
    const min = str((rangeNode as XmlNode)['@MinValue']);
    const max = str((rangeNode as XmlNode)['@MaxValue']);
    if (min !== undefined && min === max) return [{ value: coerce(min) }];
    const range: ValueRange = {};
    if (min !== undefined && min !== '') {
      range.min = coerce(min);
      range.minInclusive = str((rangeNode as XmlNode)['@MinInclusion']) !== 'Open';
    }
    if (max !== undefined && max !== '') {
      range.max = coerce(max);
      range.maxInclusive = str((rangeNode as XmlNode)['@MaxInclusion']) !== 'Open';
    }
    return Object.keys(range).length ? [range] : [];
  });
}

/**
 * NORMA encodes ring types as concatenated PascalCase names, e.g.
 * "AsymmetricIntransitive". Substring matching would misread those (both
 * contain "symmetric" and "transitive"), so the value is tokenized first.
 */
function ringTypes(value: string | undefined): RingType[] {
  if (!value) return ['irreflexive'];
  const words = value.match(/[A-Z][a-z]+/g) ?? [];
  const found: RingType[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = words[i + 1];
    if (word === 'Purely' && next === 'Reflexive') {
      found.push('purelyReflexive');
      i += 1;
      continue;
    }
    if ((word === 'Strictly' || word === 'Strongly') && next === 'Intransitive') {
      found.push('strictlyIntransitive');
      i += 1;
      continue;
    }
    const simple: Record<string, RingType> = {
      Irreflexive: 'irreflexive',
      Reflexive: 'reflexive',
      Symmetric: 'symmetric',
      Asymmetric: 'asymmetric',
      Antisymmetric: 'antisymmetric',
      Transitive: 'transitive',
      Intransitive: 'intransitive',
      Acyclic: 'acyclic',
    };
    const mapped = simple[word];
    if (mapped) found.push(mapped);
  }
  return found.length ? found : ['irreflexive'];
}

function roleSequence(node: XmlNode): Id[] {
  const sequence = first(node.RoleSequence) as XmlNode | undefined;
  return list(sequence?.Role)
    .map((r) => str((r as XmlNode)['@ref']))
    .filter((r): r is string => !!r);
}

function modality(node: XmlNode): 'alethic' | 'deontic' | undefined {
  return str(node['@Modality']) === 'Deontic' ? 'deontic' : undefined;
}

/* -------------------------------------------------------------------------- */
/* Diagram                                                                     */
/* -------------------------------------------------------------------------- */

function importDiagram(root: XmlNode, model: OrmModel): void {
  const diagrams = list(root.ORMDiagram);
  const diagram = first(diagrams) as XmlNode | undefined;
  if (!diagram) return;
  model.diagram.name = str(diagram['@Name']);

  let minX = Infinity;
  let minY = Infinity;
  const shapes: [Id, Shape][] = [];

  const collect = (node: unknown, orientation?: Shape['orientation']): void => {
    const shapeNode = node as XmlNode;
    const subject = first(shapeNode.Subject) as XmlNode | undefined;
    const ref = subject ? str(subject['@ref']) : undefined;
    const bounds = str(shapeNode['@AbsoluteBounds']);
    if (!ref || !bounds) return;
    const [x, y, w, h] = bounds.split(',').map((part) => Number(part.trim()) * PIXELS_PER_INCH);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    shapes.push([
      ref,
      {
        x,
        y,
        w: Number.isFinite(w) && w > 0 ? w : undefined,
        h: Number.isFinite(h) && h > 0 ? h : undefined,
        orientation,
      },
    ]);
  };

  for (const shape of list(diagram.ObjectTypeShape)) collect(shape);
  for (const shape of list(diagram.FactTypeShape)) {
    const orientation = str((shape as XmlNode)['@DisplayOrientation'])?.startsWith('Vertical')
      ? 'vertical'
      : 'horizontal';
    collect(shape, orientation);
  }
  for (const shape of list(diagram.ExternalConstraintShape)) collect(shape);
  for (const shape of list(diagram.FrequencyConstraintShape)) collect(shape);
  for (const shape of list(diagram.RingConstraintShape)) collect(shape);
  for (const shape of list(diagram.ValueConstraintShape)) collect(shape);

  // Shift the imported diagram so it starts near the canvas origin.
  const offsetX = Number.isFinite(minX) ? minX - 40 : 0;
  const offsetY = Number.isFinite(minY) ? minY - 40 : 0;
  for (const [id, shape] of shapes) {
    model.diagram.shapes[id] = {
      ...shape,
      x: Math.round(shape.x - offsetX),
      y: Math.round(shape.y - offsetY),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* XML helpers                                                                 */
/* -------------------------------------------------------------------------- */

function list(value: unknown): XmlNode[] {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.filter((entry): entry is XmlNode => typeof entry === 'object' && entry !== null);
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function num(value: unknown): number | undefined {
  const text = str(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length ? value : undefined;
}

function coerce(value: string): string | number {
  const parsed = Number(value);
  return value.trim() !== '' && Number.isFinite(parsed) ? parsed : value;
}

function readNote(node: XmlNode): string | undefined {
  const note = first(node.Definition) ?? first(node.Note);
  if (!note) return undefined;
  const text = first((note as XmlNode).Text);
  return nonEmpty(str(text) ?? str((note as XmlNode)['#text']));
}
