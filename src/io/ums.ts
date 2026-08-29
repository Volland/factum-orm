/**
 * The Unified Modelling Schema — the FactEngine community's YAML format for
 * graph, relational and multi-model schemas.
 *
 * UMS is logical rather than conceptual: its unit is a type with properties,
 * primary keys and relationships. Export therefore runs the same property graph
 * mapping the Graph tab shows, because that mapping already answers UMS's
 * question — which value types become properties and which fact types become
 * relationships. Import is the lossy direction: the attributes have already
 * been formed, so what comes back is the logical shape, not the model that
 * produced it.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { MODEL_SCHEMA_URL, ObjectType, OrmModel, Role } from '../model/types.js';
import { emptyModel, expandReading, newId } from '../model/model.js';
import { mapToGraph } from '../core/lpg.js';
import {
  dataTypeFromPortable,
  dataTypeToNorma,
  ExportResult,
  ImportResult,
  pascalCase,
} from './interop.js';

const UMS_VERSION = '0.1';
/** UMS tags every reading with a language; this is its value for "unset". */
const NO_LANGUAGE = 'Not Defined';

interface UmsReadings {
  Language: string;
  Readings: string[];
}

interface UmsProperty {
  Name: string;
  FactBasedName?: string | null;
  DataType: string;
  Length?: number | null;
  Precision?: number | null;
  Constraints?: string[] | null;
  FactTypeReadings?: UmsReadings[] | null;
}

interface UmsRelationship {
  Name: string;
  Label?: string | null;
  Source: string;
  Target: string;
  From: string[];
  To: string[];
  Cardinality?: string | null;
  Readings?: string[] | null;
}

interface UmsUniqueness {
  Name: string;
  Properties: string[];
}

interface UmsType {
  Type: string;
  Labels?: string[] | null;
  Label?: string | null;
  Source?: string | null;
  Target?: string | null;
  RelationshipAnnotation?: string | null;
  PrimaryKey?: string[] | null;
  Properties?: UmsProperty[] | null;
  Relationships?: UmsRelationship[] | null;
  UniquenessConstraints?: UmsUniqueness[] | null;
  IsRelationshipType: boolean;
}

interface UmsDocument {
  Name?: string;
  UMSVersionNr?: string;
  ModelVersionNr?: string | null;
  ModelElement?: UmsType[];
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

export function exportUmsFile(model: OrmModel): ExportResult {
  const schema = mapToGraph(model);
  // The graph mapping already reports what a logical schema cannot hold.
  const warnings = schema.unenforced.map(
    (u) => `${u.kind} constraint is not expressible in UMS: ${u.text}`,
  );

  const readingsOf = (sourceId: string | undefined): string[] => {
    const ft = model.factTypes.find((f) => f.id === sourceId);
    return ft ? sentences(model, ft) : [];
  };

  const elements: UmsType[] = schema.nodeTables.map((node) => {
    const relationships: UmsRelationship[] = [];
    for (const rel of schema.relTables) {
      for (const pair of rel.pairs) {
        if (pair.from !== node.name) continue;
        const target = schema.nodeTables.find((n) => n.name === pair.to);
        const key = target?.properties.find((p) => p.isPrimaryKey)?.name;
        relationships.push({
          Name: rel.name,
          Label: rel.name,
          Source: node.name,
          Target: pair.to,
          From: key ? [key] : [],
          To: key ? [key] : [],
          Cardinality: rel.multiplicity,
          Readings: rel.sources
            .filter((s) => s.kind === 'factType')
            .flatMap((s) => readingsOf(s.id)),
        });
      }
    }

    return {
      Type: node.name,
      Labels: [node.name, ...(nodeExtraLabels(model, node.sourceId) ?? [])],
      Label: null,
      Source: null,
      Target: null,
      RelationshipAnnotation: null,
      PrimaryKey: node.properties.filter((p) => p.isPrimaryKey).map((p) => p.name),
      Properties: node.properties.map((property) => {
        const constraints: string[] = [];
        if (property.isPrimaryKey) constraints.push('PrimaryKey');
        if (property.isRequired || property.isPrimaryKey) constraints.push('NotNull');
        const ft = model.factTypes.find((f) => f.roles.some((r) => r.id === property.sourceRoleId));
        return {
          Name: property.name,
          FactBasedName: sourceName(model, property.sourceObjectTypeId) ?? null,
          DataType: dataTypeToNorma(property.dataType, property.length),
          Length: property.length ?? null,
          Precision: property.scale ?? null,
          Constraints: constraints.length ? constraints : null,
          FactTypeReadings: ft ? [{ Language: NO_LANGUAGE, Readings: sentences(model, ft) }] : null,
        };
      }),
      Relationships: relationships.length ? relationships : null,
      UniquenessConstraints: null,
      IsRelationshipType: node.isReified,
    };
  });

  const document: UmsDocument = {
    Name: model.name,
    UMSVersionNr: UMS_VERSION,
    ModelVersionNr: null,
    ModelElement: elements,
  };
  return { text: stringifyYaml(document, { lineWidth: 120 }), warnings };
}

/** Each reading with its placeholders replaced by the role players' names. */
function sentences(model: OrmModel, ft: { readings: OrmModel['factTypes'][number]['readings']; roles: Role[] }): string[] {
  return ft.readings.map((reading) =>
    expandReading(reading, (roleId) => {
      const role = ft.roles.find((r) => r.id === roleId);
      const player = model.objectTypes.find((o) => o.id === role?.objectTypeId);
      return player?.name ?? '...';
    }),
  );
}

function nodeExtraLabels(model: OrmModel, sourceId: string): string[] | undefined {
  return model.objectTypes.find((o) => o.id === sourceId)?.hints?.graph?.labels;
}

function sourceName(model: OrmModel, objectTypeId: string | undefined): string | undefined {
  return objectTypeId ? model.objectTypes.find((o) => o.id === objectTypeId)?.name : undefined;
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

export function importUmsFile(text: string): ImportResult {
  const parsed = parseYaml(text) as UmsDocument | undefined;
  const elements = parsed?.ModelElement;
  if (!parsed || !Array.isArray(elements)) {
    throw new Error('Not a UMS document: no top-level `ModelElement` list was found.');
  }

  const warnings: string[] = [
    'UMS is a logical schema, so this model is the shape the data takes rather than the elementary facts behind it. Attributes arrive as value types and foreign keys as binary fact types; review the reference schemes before mapping it back out.',
  ];
  const model = emptyModel(parsed.Name ?? 'Imported Model');
  model.$schema = MODEL_SCHEMA_URL;
  model.generator = { name: 'Factum UMS importer' };
  model.meta = { source: { tool: 'Unified Modelling Schema', version: parsed.UMSVersionNr } };

  const byType = new Map<string, ObjectType>();
  for (const element of elements) {
    if (!element?.Type) continue;
    const ot: ObjectType = { id: newId('ot'), name: element.Type, kind: 'entity' };
    const labels = (element.Labels ?? []).filter((l) => l && l !== element.Type);
    if (labels.length) ot.hints = { graph: { labels } };
    byType.set(element.Type, ot);
    model.objectTypes.push(ot);
  }

  for (const element of elements) {
    const owner = element?.Type ? byType.get(element.Type) : undefined;
    if (!owner) continue;
    const primaryKey = new Set(element.PrimaryKey ?? []);
    // A foreign key column is the relationship's business, not a property.
    const foreignKeys = new Set((element.Relationships ?? []).flatMap((r) => r.From ?? []));

    for (const property of element.Properties ?? []) {
      if (!property?.Name || foreignKeys.has(property.Name)) continue;
      const valueType: ObjectType = {
        id: newId('vt'),
        name: property.FactBasedName || property.Name,
        kind: 'value',
        dataType: dataTypeFromPortable(property.DataType) ?? 'string',
        ...(property.Length ? { dataTypeLength: property.Length } : {}),
        ...(property.Precision ? { dataTypeScale: property.Precision } : {}),
      };
      model.objectTypes.push(valueType);

      const roles: Role[] = [
        { id: newId('r'), objectTypeId: owner.id },
        { id: newId('r'), objectTypeId: valueType.id },
      ];
      const readings = (property.FactTypeReadings ?? []).flatMap((r) => r.Readings ?? []);
      model.factTypes.push({
        id: newId('ft'),
        roles,
        readings: [
          {
            id: newId('rd'),
            roleOrder: [roles[0].id, roles[1].id],
            text: `{0} has {1}`,
            isPrimary: true,
            ...(readings[0] ? { lang: undefined } : {}),
          },
        ],
        ...(readings.length ? { note: readings.join('\n') } : {}),
      });

      // A property holds one value per object, which is uniqueness on the owner.
      model.constraints.push({ kind: 'uniqueness', id: newId('uc'), roles: [roles[0].id] });
      if (primaryKey.has(property.Name)) {
        model.constraints.push({
          kind: 'uniqueness',
          id: newId('uc'),
          roles: [roles[1].id],
          isPreferredIdentifier: true,
        });
      }
      const constraints = property.Constraints ?? [];
      if (constraints.some((c) => /notnull|not null/i.test(c)) || primaryKey.has(property.Name)) {
        model.constraints.push({ kind: 'mandatory', id: newId('mc'), roles: [roles[0].id] });
      }
    }

    for (const relationship of element.Relationships ?? []) {
      const target = relationship?.Target ? byType.get(relationship.Target) : undefined;
      if (!target) {
        warnings.push(
          `Relationship "${relationship?.Name}" points at unknown type "${relationship?.Target}" and was skipped.`,
        );
        continue;
      }
      const roles: Role[] = [
        { id: newId('r'), objectTypeId: owner.id },
        { id: newId('r'), objectTypeId: target.id },
      ];
      const readings = relationship.Readings ?? [];
      model.factTypes.push({
        id: newId('ft'),
        roles,
        readings: [
          {
            id: newId('rd'),
            roleOrder: [roles[0].id, roles[1].id],
            text: `{0} ${readingPredicate(relationship.Name)} {1}`,
            isPrimary: true,
          },
        ],
        ...(readings.length ? { note: readings.join('\n') } : {}),
      });
      // `MANY_ONE` and friends name the end that is functionally determined.
      const cardinality = (relationship.Cardinality ?? '').toUpperCase();
      if (!cardinality || cardinality.startsWith('MANY_ONE') || cardinality.startsWith('ONE_ONE')) {
        model.constraints.push({ kind: 'uniqueness', id: newId('uc'), roles: [roles[0].id] });
      }
      if (cardinality.startsWith('ONE_ONE') || cardinality.startsWith('ONE_MANY')) {
        model.constraints.push({ kind: 'uniqueness', id: newId('uc'), roles: [roles[1].id] });
      }
    }

    for (const unique of element.UniquenessConstraints ?? []) {
      if (!unique?.Properties?.length) continue;
      const roles = unique.Properties.map((name) => roleForProperty(model, owner, name)).filter(
        (r): r is string => !!r,
      );
      if (roles.length) {
        model.constraints.push({ kind: 'uniqueness', id: newId('uc'), name: unique.Name, roles });
      }
    }
  }

  return { model, warnings };
}

/** The role a named property ended up playing, so composite keys can find it. */
function roleForProperty(model: OrmModel, owner: ObjectType, property: string): string | undefined {
  const wanted = pascalCase(property);
  for (const ft of model.factTypes) {
    const ownerRole = ft.roles.find((r) => r.objectTypeId === owner.id);
    const other = ft.roles.find((r) => r.id !== ownerRole?.id);
    if (!ownerRole || !other) continue;
    const player = model.objectTypes.find((o) => o.id === other.objectTypeId);
    if (player && pascalCase(player.name) === wanted) return other.id;
  }
  return undefined;
}

/** `WORKS_FOR` reads as `works for`. */
function readingPredicate(name: string | undefined): string {
  if (!name) return 'relates to';
  return name.replace(/[_-]+/g, ' ').trim().toLowerCase() || 'relates to';
}
