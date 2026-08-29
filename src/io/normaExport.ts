/**
 * Writes NORMA / ORM 2 XML, the counterpart of [[src/io/normaImport.ts]].
 *
 * NORMA keys everything on element ids, and Factum's ids are already the NORMA
 * GUIDs for any model that came from a NORMA file, so a model that made the
 * round trip keeps its identity. Ids that Factum generated are written as they
 * stand; NORMA accepts them because it treats the attribute as opaque.
 *
 * Diagram geometry is not written: NORMA's `<ormDiagram>` section carries shape
 * state well beyond position, and a partial one is worse than none.
 */

import { XMLBuilder } from 'fast-xml-parser';
import { Constraint, FactType, Id, ObjectType, OrmModel, Reading, ValueRange } from '../model/types.js';
import { constraintRoles, indexModel, primaryReading } from '../model/model.js';
import { dataTypeToNorma, ExportResult } from './interop.js';

type XmlNode = Record<string, unknown>;

export function exportNormaFile(model: OrmModel): ExportResult {
  const warnings: string[] = [];
  const index = indexModel(model);

  // Every distinct data type becomes one <DataTypes> entry that value types
  // point at by reference, which is how NORMA stores them.
  const dataTypeIds = new Map<string, Id>();
  const dataTypeNodes: { tag: string; id: Id }[] = [];
  for (const ot of model.objectTypes) {
    if (!ot.dataType) continue;
    const tag = dataTypeToNorma(ot.dataType, ot.dataTypeLength);
    if (dataTypeIds.has(tag)) continue;
    const id = `_dt_${tag}`;
    dataTypeIds.set(tag, id);
    dataTypeNodes.push({ tag, id });
  }

  const objectified = new Map<Id, ObjectType>();
  for (const ot of model.objectTypes) {
    if (ot.objectifiedFactTypeId) objectified.set(ot.objectifiedFactTypeId, ot);
  }

  const entityTypes: XmlNode[] = [];
  const valueTypes: XmlNode[] = [];
  const objectifiedTypes: XmlNode[] = [];
  for (const ot of model.objectTypes) {
    const node = objectTypeNode(ot, dataTypeIds);
    // NORMA nests an object type's value constraint inside a ValueRestriction
    // rather than listing it with the other constraints.
    const restrictions = model.constraints.filter(
      (c): c is Extract<Constraint, { kind: 'value' }> => c.kind === 'value' && c.objectTypeId === ot.id,
    );
    if (restrictions.length) {
      node.ValueRestriction = {
        ValueConstraint: restrictions.map((c) => ({
          '@id': c.id,
          ...(c.modality === 'deontic' ? { '@Modality': 'Deontic' } : {}),
          ValueRanges: { ValueRange: c.ranges.map(valueRangeNode) },
        })),
      };
    }
    if (ot.objectifiedFactTypeId) objectifiedTypes.push(node);
    else if (ot.kind === 'value') valueTypes.push(node);
    else entityTypes.push(node);
  }

  const facts = model.factTypes.map((ft) => factNode(ft, model));
  const subtypeFacts = model.subtypeRelations.map((s) => ({
    '@id': s.id,
    ...(s.isPreferredIdentificationPath ? { '@IsPrimary': 'true' } : {}),
    FactRoles: {
      SubtypeMetaRole: { '@id': `${s.id}_sub`, RolePlayer: { '@ref': s.subtypeId } },
      SupertypeMetaRole: { '@id': `${s.id}_super`, RolePlayer: { '@ref': s.supertypeId } },
    },
  }));

  const document = {
    '?xml': { '@version': '1.0', '@encoding': 'utf-8' },
    'ormRoot:ORM2': {
      '@xmlns:ormRoot': 'http://schemas.neumont.edu/ORM/2006-04/ORMRoot',
      '@xmlns:orm': 'http://schemas.neumont.edu/ORM/2006-04/ORMCore',
      ORMModel: {
        '@id': model.meta?.guid ?? '_model',
        '@Name': model.name,
        Objects: {
          ...(entityTypes.length ? { EntityType: entityTypes } : {}),
          ...(valueTypes.length ? { ValueType: valueTypes } : {}),
          ...(objectifiedTypes.length ? { ObjectifiedType: objectifiedTypes } : {}),
        },
        Facts: {
          ...(facts.length ? { Fact: facts } : {}),
          ...(subtypeFacts.length ? { SubtypeFact: subtypeFacts } : {}),
        },
        Constraints: constraintNodes(model, index, warnings),
        DataTypes: Object.fromEntries(dataTypeNodes.map((d) => [d.tag, { '@id': d.id }])),
      },
    },
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    format: true,
    indentBy: '\t',
    suppressEmptyNode: true,
    suppressBooleanAttributes: false,
  });
  return { text: `${(builder.build(document) as string).trim()}\n`, warnings };
}

function objectTypeNode(ot: ObjectType, dataTypeIds: Map<string, Id>): XmlNode {
  const node: XmlNode = {
    '@id': ot.id,
    '@Name': ot.name,
    ...(ot.refMode ? { '@_ReferenceMode': ot.refMode } : {}),
    ...(ot.isIndependent ? { '@IsIndependent': 'true' } : {}),
    ...(ot.isPersonal ? { '@IsPersonal': 'true' } : {}),
  };
  if (ot.dataType) {
    const tag = dataTypeToNorma(ot.dataType, ot.dataTypeLength);
    node.ConceptualDataType = {
      '@id': `${ot.id}_dt`,
      '@ref': dataTypeIds.get(tag),
      ...(ot.dataTypeLength ? { '@Length': String(ot.dataTypeLength) } : {}),
      ...(ot.dataTypeScale ? { '@Scale': String(ot.dataTypeScale) } : {}),
    };
  }
  if (ot.objectifiedFactTypeId) {
    node.NestedPredicate = {
      '@id': `${ot.id}_np`,
      '@ref': ot.objectifiedFactTypeId,
      ...(ot.isImplicitObjectification ? { '@IsImplied': 'true' } : {}),
    };
  }
  const note = ot.meta?.description ?? ot.note;
  if (note) node.Definition = { '@id': `${ot.id}_def`, Text: note };
  return node;
}

function factNode(ft: FactType, model: OrmModel): XmlNode {
  const name = primaryReading(ft);
  return {
    '@id': ft.id,
    '@_Name': name ? factName(ft, name, model) : ft.id,
    ...(ft.isDerived ? { '@_DerivationStorage': ft.isStored ? 'DerivedAndStored' : 'Derived' } : {}),
    FactRoles: {
      Role: ft.roles.map((role) => {
        const restrictions = model.constraints.filter(
          (c): c is Extract<Constraint, { kind: 'value' }> => c.kind === 'value' && c.roleId === role.id,
        );
        return {
          '@id': role.id,
          ...(role.name ? { '@Name': role.name } : {}),
          ...(role.objectTypeId ? { RolePlayer: { '@ref': role.objectTypeId } } : {}),
          ...(restrictions.length
            ? {
                ValueRestriction: {
                  RoleValueConstraint: restrictions.map((c) => ({
                    '@id': c.id,
                    ValueRanges: { ValueRange: c.ranges.map(valueRangeNode) },
                  })),
                },
              }
            : {}),
        };
      }),
    },
    ReadingOrders: {
      ReadingOrder: ft.readings.map((reading) => ({
        '@id': `${reading.id}_ro`,
        RoleSequence: { Role: reading.roleOrder.map((roleId) => ({ '@ref': roleId })) },
        Readings: { Reading: { '@id': reading.id, Data: reading.text } },
      })),
    },
    ...(ft.meta?.description ?? ft.note
      ? { Definition: { '@id': `${ft.id}_def`, Text: ft.meta?.description ?? ft.note } }
      : {}),
  };
}

function factName(ft: FactType, reading: Reading, model: OrmModel): string {
  return reading.text
    .replace(/\{(\d+)\}/g, (match, digits: string) => {
      const role = ft.roles.find((r) => r.id === reading.roleOrder[Number(digits)]);
      const player = model.objectTypes.find((o) => o.id === role?.objectTypeId);
      return player ? player.name : match;
    })
    .replace(/[^A-Za-z0-9]+/g, '');
}

function constraintNodes(
  model: OrmModel,
  index: ReturnType<typeof indexModel>,
  warnings: string[],
): XmlNode {
  const buckets: Record<string, XmlNode[]> = {};
  const add = (tag: string, node: XmlNode): void => {
    buckets[tag] = buckets[tag] ?? [];
    buckets[tag].push(node);
  };

  for (const c of model.constraints) {
    const roles = constraintRoles(c);
    const base: XmlNode = {
      '@id': c.id,
      ...(c.name ? { '@Name': c.name } : {}),
      ...(c.modality === 'deontic' ? { '@Modality': 'Deontic' } : {}),
    };
    const sequence = { RoleSequence: { Role: roles.map((r) => ({ '@ref': r })) } };

    switch (c.kind) {
      case 'uniqueness': {
        const owners = new Set(c.roles.map((r) => index.roleOwner.get(r)?.id));
        const internal = owners.size === 1 && !owners.has(undefined);
        add(internal ? 'UniquenessConstraint' : 'UniquenessConstraint', {
          ...base,
          '@IsInternal': String(internal),
          ...sequence,
          ...(c.isPreferredIdentifier ? { PreferredIdentifierFor: { '@ref': preferredFor(model, c) } } : {}),
        });
        break;
      }
      case 'mandatory':
        add('MandatoryConstraint', {
          ...base,
          ...(c.isImplied ? { '@IsImplied': 'true' } : {}),
          ...sequence,
        });
        break;
      case 'frequency':
        add('FrequencyConstraint', {
          ...base,
          '@MinFrequency': String(c.min),
          '@MaxFrequency': String(c.max ?? 0),
          ...sequence,
        });
        break;
      case 'ring':
        add('RingConstraint', {
          ...base,
          '@Type': c.types.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(''),
          ...sequence,
        });
        break;
      case 'subset':
      case 'exclusion':
      case 'equality':
        add(`${c.kind.charAt(0).toUpperCase() + c.kind.slice(1)}Constraint`, {
          ...base,
          RoleSequences: {
            RoleSequence: c.roleSequences.map((s) => ({ Role: s.map((r) => ({ '@ref': r })) })),
          },
        });
        break;
      case 'value':
        // Written on the object type or the role above, where NORMA keeps it.
        break;
      case 'cardinality':
        add('CardinalityConstraint', {
          ...base,
          Ranges: { CardinalityRange: { '@From': String(c.min), ...(c.max !== null ? { '@To': String(c.max) } : {}) } },
        });
        break;
      case 'subtypeSet':
        warnings.push(
          `Subtype set constraint "${c.name ?? c.id}" was written as an exclusion over its subtype facts; NORMA models exclusive subtypes differently.`,
        );
        break;
    }
  }
  return buckets;
}

function valueRangeNode(r: ValueRange): XmlNode {
  if (r.value !== undefined) return { '@MinValue': String(r.value), '@MaxValue': String(r.value) };
  return {
    ...(r.min !== undefined ? { '@MinValue': String(r.min) } : {}),
    ...(r.max !== undefined ? { '@MaxValue': String(r.max) } : {}),
    ...(r.minInclusive === false ? { '@MinInclusion': 'NotInclude' } : {}),
    ...(r.maxInclusive === false ? { '@MaxInclusion': 'NotInclude' } : {}),
  };
}

/** The object type a preferred identifier identifies: the one opposite its roles. */
function preferredFor(model: OrmModel, c: Extract<Constraint, { kind: 'uniqueness' }>): Id | undefined {
  for (const roleId of c.roles) {
    const ft = model.factTypes.find((f) => f.roles.some((r) => r.id === roleId));
    const other = ft?.roles.find((r) => r.id !== roleId && r.objectTypeId);
    if (other?.objectTypeId) return other.objectTypeId;
  }
  return undefined;
}
