import {
  Constraint,
  DataType,
  FactType,
  Id,
  ObjectType,
  OrmModel,
  RingType,
  SubtypeRelation,
  ValueRange,
} from '../model/types.js';
import { factTypeOfRole, indexModel, newId, primaryReading } from '../model/model.js';
import { Issue } from '../core/validate.js';
import { verbalizeModel } from '../core/verbalize.js';
import { mapToRelational } from '../core/rmap.js';
import { generateDdl } from '../core/ddl.js';
import { mapToGraph, Multiplicity } from '../core/lpg.js';
import { generateGraphDdl } from '../core/graphDdl.js';
import { WebviewSettings } from '../protocol.js';
import { h, clear } from './dom.js';

export type PanelTab = 'properties' | 'verbalization' | 'relational' | 'graph' | 'problems';

export interface PanelHost {
  model: OrmModel;
  selection: Set<Id>;
  selectedRoles: Set<Id>;
  issues: Issue[];
  settings: WebviewSettings;
  commit(label: string, mutate: (model: OrmModel) => void): void;
  select(id: Id, options?: { reveal?: boolean }): void;
  notify(level: 'info' | 'warning' | 'error', message: string): void;
}

const DATA_TYPES: DataType[] = [
  'string',
  'text',
  'integer',
  'decimal',
  'float',
  'money',
  'boolean',
  'date',
  'time',
  'dateTime',
  'guid',
  'binary',
  'autoCounter',
];

const RING_TYPES: RingType[] = [
  'irreflexive',
  'reflexive',
  'purelyReflexive',
  'symmetric',
  'asymmetric',
  'antisymmetric',
  'transitive',
  'intransitive',
  'strictlyIntransitive',
  'acyclic',
];

export function renderPanel(container: HTMLElement, tab: PanelTab, host: PanelHost): void {
  clear(container);
  switch (tab) {
    case 'properties':
      container.append(renderProperties(host));
      break;
    case 'verbalization':
      container.append(renderVerbalization(host));
      break;
    case 'relational':
      container.append(renderRelational(host));
      break;
    case 'graph':
      container.append(renderGraph(host));
      break;
    case 'problems':
      container.append(renderProblems(host));
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* Properties                                                                  */
/* -------------------------------------------------------------------------- */

function renderProperties(host: PanelHost): HTMLElement {
  const { model } = host;
  const selected = [...host.selection];
  if (selected.length !== 1) {
    return selected.length > 1 ? renderMultiSelection(host) : renderModelProperties(host);
  }
  const id = selected[0];

  const objectType = model.objectTypes.find((o) => o.id === id);
  if (objectType) return renderObjectTypeProperties(host, objectType);

  const factType = model.factTypes.find((f) => f.id === id);
  if (factType) return renderFactTypeProperties(host, factType);

  const constraint = model.constraints.find((c) => c.id === id);
  if (constraint) return renderConstraintProperties(host, constraint);

  const subtype = model.subtypeRelations.find((s) => s.id === id);
  if (subtype) return renderSubtypeProperties(host, subtype);

  return renderModelProperties(host);
}

function renderModelProperties(host: PanelHost): HTMLElement {
  const { model } = host;
  return section('Model', [
    field('Name', textInput(model.name, (value) => host.commit('Rename model', (m) => { m.name = value; }))),
    field(
      'Note',
      textArea(model.note ?? '', (value) =>
        host.commit('Edit note', (m) => {
          m.note = value || undefined;
        }),
      ),
    ),
    h('dl', { class: 'stats' }, [
      h('dt', { text: 'Object types' }),
      h('dd', { text: String(model.objectTypes.length) }),
      h('dt', { text: 'Fact types' }),
      h('dd', { text: String(model.factTypes.length) }),
      h('dt', { text: 'Constraints' }),
      h('dd', { text: String(model.constraints.length) }),
      h('dt', { text: 'Subtype links' }),
      h('dd', { text: String(model.subtypeRelations.length) }),
    ]),
    h('p', { class: 'hint', text: 'Select a shape to edit it. Click role boxes to build constraints.' }),
  ]);
}

function renderMultiSelection(host: PanelHost): HTMLElement {
  return section(`${host.selection.size} elements selected`, [
    h('p', { class: 'hint', text: 'Drag to move them together, or press Delete to remove them.' }),
  ]);
}

function renderObjectTypeProperties(host: PanelHost, ot: ObjectType): HTMLElement {
  const { model } = host;
  const update = (label: string, change: (target: ObjectType) => void): void =>
    host.commit(label, (m) => {
      const target = m.objectTypes.find((o) => o.id === ot.id);
      if (target) change(target);
    });

  const valueConstraint = model.constraints.find(
    (c): c is Extract<Constraint, { kind: 'value' }> => c.kind === 'value' && c.objectTypeId === ot.id,
  );

  const fields: (HTMLElement | null)[] = [
    field('Name', textInput(ot.name, (value) => update('Rename object type', (target) => { target.name = value; }))),
    field(
      'Kind',
      select(
        [
          ['entity', 'Entity type'],
          ['value', 'Value type'],
        ],
        ot.kind,
        (value) =>
          update('Change object type kind', (target) => {
            target.kind = value as 'entity' | 'value';
            if (target.kind === 'value') target.refMode = undefined;
          }),
      ),
    ),
    ot.kind === 'entity'
      ? field(
          'Reference mode',
          textInput(ot.refMode ?? '', (value) =>
            update('Change reference mode', (target) => {
              target.refMode = value.trim() || undefined;
            }),
          ),
          'Written as Person(.nr). Leave empty for a compound or external identifier.',
        )
      : null,
    field(
      'Data type',
      select(
        [['', '(unspecified)'], ...DATA_TYPES.map((t) => [t, t] as [string, string])],
        ot.dataType ?? '',
        (value) =>
          update('Change data type', (target) => {
            target.dataType = (value || undefined) as DataType | undefined;
          }),
      ),
    ),
    field(
      'Length / scale',
      h('div', { class: 'row' }, [
        numberInput(ot.dataTypeLength, (value) =>
          update('Change length', (target) => {
            target.dataTypeLength = value;
          }),
        ),
        numberInput(ot.dataTypeScale, (value) =>
          update('Change scale', (target) => {
            target.dataTypeScale = value;
          }),
        ),
      ]),
    ),
    checkbox('Independent (!)', !!ot.isIndependent, (value) =>
      update('Toggle independent', (target) => {
        target.isIndependent = value || undefined;
      }),
    ),
    checkbox('Personal', !!ot.isPersonal, (value) =>
      update('Toggle personal', (target) => {
        target.isPersonal = value || undefined;
      }),
    ),
    field(
      'Value constraint',
      textInput(valueConstraint ? rangesToText(valueConstraint.ranges) : '', (value) =>
        host.commit('Edit value constraint', (m) => {
          const ranges = parseRanges(value);
          const existing = m.constraints.find((c) => c.kind === 'value' && c.objectTypeId === ot.id);
          if (!ranges.length) {
            m.constraints = m.constraints.filter((c) => c !== existing);
            return;
          }
          if (existing && existing.kind === 'value') existing.ranges = ranges;
          else m.constraints.push({ id: newId('vc'), kind: 'value', objectTypeId: ot.id, ranges });
        }),
      ),
      "Examples: 'M', 'F'  |  1..10  |  0.., 'x'",
    ),
    field(
      'Note',
      textArea(ot.note ?? '', (value) =>
        update('Edit note', (target) => {
          target.note = value || undefined;
        }),
      ),
    ),
  ];

  const playedRoles = indexModel(model).playedRoles.get(ot.id) ?? [];
  const roleList = playedRoles.length
    ? h(
        'ul',
        { class: 'link-list' },
        playedRoles.map((role) => {
          const ft = factTypeOfRole(model, role.id);
          return h('li', {}, [
            h('a', {
              href: '#',
              text: ft ? readingOf(ft) : role.id,
              onclick: (event: Event) => {
                event.preventDefault();
                if (ft) host.select(ft.id, { reveal: true });
              },
            }),
          ]);
        }),
      )
    : h('p', { class: 'hint', text: 'Plays no fact roles yet.' });

  return h('div', {}, [
    section(ot.kind === 'entity' ? 'Entity type' : 'Value type', fields.filter(Boolean) as HTMLElement[]),
    section('Plays roles in', [roleList]),
  ]);
}

function renderFactTypeProperties(host: PanelHost, ft: FactType): HTMLElement {
  const { model } = host;
  const update = (label: string, change: (target: FactType) => void): void =>
    host.commit(label, (m) => {
      const target = m.factTypes.find((f) => f.id === ft.id);
      if (target) change(target);
    });

  const readings = h(
    'div',
    { class: 'readings' },
    ft.readings.map((reading) =>
      h('div', { class: 'reading-row' }, [
        h('input', {
          type: 'radio',
          name: 'primary-reading',
          checked: reading.isPrimary || primaryReading(ft)?.id === reading.id,
          title: 'Primary reading',
          onchange: () =>
            update('Set primary reading', (target) => {
              for (const other of target.readings) other.isPrimary = other.id === reading.id || undefined;
            }),
        }),
        h('input', {
          type: 'text',
          value: reading.text,
          class: 'reading-input',
          onchange: (event: Event) => {
            const value = (event.target as HTMLInputElement).value;
            update('Edit reading', (target) => {
              const found = target.readings.find((r) => r.id === reading.id);
              if (found) found.text = value;
            });
          },
        }),
        h('span', { class: 'role-order', text: reading.roleOrder.map((id) => rolePlayerName(model, id)).join(' · ') }),
        h('button', {
          class: 'icon-button',
          title: 'Delete reading',
          text: '✕',
          onclick: () =>
            update('Delete reading', (target) => {
              target.readings = target.readings.filter((r) => r.id !== reading.id);
            }),
        }),
      ]),
    ),
  );

  const roles = h(
    'div',
    { class: 'roles' },
    ft.roles.map((role, position) =>
      h('div', { class: 'role-row' }, [
        h('span', { class: 'role-index', text: `{${position}}` }),
        select(
          [['', '(unattached)'], ...model.objectTypes.map((o) => [o.id, o.name] as [string, string])],
          role.objectTypeId ?? '',
          (value) =>
            update('Change role player', (target) => {
              const found = target.roles.find((r) => r.id === role.id);
              if (found) found.objectTypeId = value || null;
            }),
        ),
        h('input', {
          type: 'text',
          value: role.name ?? '',
          placeholder: 'role name',
          class: 'role-name-input',
          onchange: (event: Event) => {
            const value = (event.target as HTMLInputElement).value.trim();
            update('Rename role', (target) => {
              const found = target.roles.find((r) => r.id === role.id);
              if (found) found.name = value || undefined;
            });
          },
        }),
      ]),
    ),
  );

  const objectifier = model.objectTypes.find((o) => o.objectifiedFactTypeId === ft.id);

  return h('div', {}, [
    section('Fact type', [
      field('Readings', readings),
      h('button', {
        class: 'wide-button',
        text: '+ Add reading',
        onclick: () =>
          update('Add reading', (target) => {
            target.readings.push({
              id: newId('rd'),
              roleOrder: target.roles.map((r) => r.id),
              text: target.roles.map((_, position) => `{${position}}`).join(' ... '),
            });
          }),
      }),
      field(
        'Orientation',
        select(
          [
            ['horizontal', 'Horizontal'],
            ['vertical', 'Vertical'],
          ],
          model.diagram.shapes[ft.id]?.orientation ?? 'horizontal',
          (value) =>
            host.commit('Change orientation', (m) => {
              const shape = m.diagram.shapes[ft.id] ?? { x: 100, y: 100 };
              m.diagram.shapes[ft.id] = { ...shape, orientation: value as 'horizontal' | 'vertical' };
            }),
        ),
      ),
      checkbox('Derived', !!ft.isDerived, (value) =>
        update('Toggle derived', (target) => {
          target.isDerived = value || undefined;
        }),
      ),
      ft.isDerived
        ? field(
            'Derivation rule',
            textArea(ft.derivationRule ?? '', (value) =>
              update('Edit derivation rule', (target) => {
                target.derivationRule = value || undefined;
              }),
            ),
          )
        : null,
      ft.isDerived
        ? checkbox('Derived and stored', !!ft.isStored, (value) =>
            update('Toggle stored', (target) => {
              target.isStored = value || undefined;
            }),
          )
        : null,
    ].filter(Boolean) as HTMLElement[]),
    section('Roles', [
      roles,
      h('div', { class: 'row' }, [
        h('button', {
          text: '+ Add role',
          onclick: () =>
            update('Add role', (target) => {
              const role = { id: newId('r'), objectTypeId: null };
              target.roles.push(role);
              for (const reading of target.readings) {
                reading.roleOrder.push(role.id);
                reading.text = `${reading.text} ... {${reading.roleOrder.length - 1}}`;
              }
            }),
        }),
        ft.roles.length > 1
          ? h('button', {
              text: '− Remove last role',
              onclick: () =>
                update('Remove role', (target) => {
                  const removed = target.roles.pop();
                  if (!removed) return;
                  for (const reading of target.readings) {
                    reading.roleOrder = reading.roleOrder.filter((id) => id !== removed.id);
                    reading.text = reading.text.replace(new RegExp(`\\s*\\.*\\s*\\{${target.roles.length}\\}`), '');
                  }
                }),
            })
          : null,
      ].filter(Boolean) as HTMLElement[]),
    ]),
    section('Objectification', [
      objectifier
        ? h('div', {}, [
            h('p', { class: 'hint', text: `Objectified as "${objectifier.name}".` }),
            h('button', {
              text: 'Remove objectification',
              onclick: () =>
                host.commit('Remove objectification', (m) => {
                  m.objectTypes = m.objectTypes.filter((o) => o.id !== objectifier.id);
                }),
            }),
          ])
        : h('button', {
            text: 'Objectify this fact type',
            onclick: () =>
              host.commit('Objectify fact type', (m) => {
                const target = m.factTypes.find((f) => f.id === ft.id);
                if (!target) return;
                const reading = primaryReading(target);
                const name = suggestObjectificationName(m, reading?.text ?? 'Fact');
                const shape = m.diagram.shapes[ft.id] ?? { x: 100, y: 100 };
                const id = newId('ot');
                m.objectTypes.push({ id, name, kind: 'entity', objectifiedFactTypeId: ft.id });
                m.diagram.shapes[id] = { x: shape.x, y: shape.y - 70 };
              }),
          }),
    ]),
  ]);
}

function renderConstraintProperties(host: PanelHost, constraint: Constraint): HTMLElement {
  const update = (label: string, change: (target: Constraint) => void): void =>
    host.commit(label, (m) => {
      const target = m.constraints.find((c) => c.id === constraint.id);
      if (target) change(target);
    });

  const common: HTMLElement[] = [
    field('Name', textInput(constraint.name ?? '', (value) =>
      update('Rename constraint', (target) => {
        target.name = value || undefined;
      }),
    )),
    field(
      'Modality',
      select(
        [
          ['alethic', 'Alethic (must)'],
          ['deontic', 'Deontic (should)'],
        ],
        constraint.modality ?? 'alethic',
        (value) =>
          update('Change modality', (target) => {
            target.modality = value === 'deontic' ? 'deontic' : undefined;
          }),
      ),
    ),
  ];

  const specific: HTMLElement[] = [];
  switch (constraint.kind) {
    case 'uniqueness':
      specific.push(
        checkbox('Preferred identifier', !!constraint.isPreferredIdentifier, (value) =>
          update('Toggle preferred identifier', (target) => {
            if (target.kind === 'uniqueness') target.isPreferredIdentifier = value || undefined;
          }),
        ),
      );
      break;
    case 'frequency':
      specific.push(
        field(
          'Frequency',
          h('div', { class: 'row' }, [
            numberInput(constraint.min, (value) =>
              update('Change frequency', (target) => {
                if (target.kind === 'frequency') target.min = value ?? 1;
              }),
            ),
            numberInput(constraint.max ?? undefined, (value) =>
              update('Change frequency', (target) => {
                if (target.kind === 'frequency') target.max = value ?? null;
              }),
            ),
          ]),
          'Minimum and maximum. Leave the maximum empty for "or more".',
        ),
      );
      break;
    case 'cardinality':
      specific.push(
        field(
          'Cardinality',
          h('div', { class: 'row' }, [
            numberInput(constraint.min, (value) =>
              update('Change cardinality', (target) => {
                if (target.kind === 'cardinality') target.min = value ?? 0;
              }),
            ),
            numberInput(constraint.max ?? undefined, (value) =>
              update('Change cardinality', (target) => {
                if (target.kind === 'cardinality') target.max = value ?? null;
              }),
            ),
          ]),
        ),
      );
      break;
    case 'ring':
      specific.push(
        field(
          'Ring types',
          h(
            'div',
            { class: 'checkbox-grid' },
            RING_TYPES.map((type) =>
              checkbox(type, constraint.types.includes(type), (value) =>
                update('Change ring types', (target) => {
                  if (target.kind !== 'ring') return;
                  target.types = value
                    ? [...target.types, type]
                    : target.types.filter((existing) => existing !== type);
                }),
              ),
            ),
          ),
        ),
      );
      break;
    case 'value':
      specific.push(
        field(
          'Values',
          textInput(rangesToText(constraint.ranges), (value) =>
            update('Edit values', (target) => {
              if (target.kind === 'value') target.ranges = parseRanges(value);
            }),
          ),
        ),
      );
      break;
    case 'subtypeSet':
      specific.push(
        checkbox('Exclusive', !!constraint.isExclusive, (value) =>
          update('Toggle exclusive', (target) => {
            if (target.kind === 'subtypeSet') target.isExclusive = value || undefined;
          }),
        ),
        checkbox('Exhaustive', !!constraint.isExhaustive, (value) =>
          update('Toggle exhaustive', (target) => {
            if (target.kind === 'subtypeSet') target.isExhaustive = value || undefined;
          }),
        ),
      );
      break;
    default:
      break;
  }

  const roleSummary = h('p', {
    class: 'hint',
    text: describeConstrainedRoles(host.model, constraint),
  });

  return section(`${capitalize(constraint.kind)} constraint`, [...common, ...specific, roleSummary]);
}

function renderSubtypeProperties(host: PanelHost, relation: SubtypeRelation): HTMLElement {
  const { model } = host;
  const options = model.objectTypes.map((o) => [o.id, o.name] as [string, string]);
  const update = (label: string, change: (target: SubtypeRelation) => void): void =>
    host.commit(label, (m) => {
      const target = m.subtypeRelations.find((s) => s.id === relation.id);
      if (target) change(target);
    });
  return section('Subtype link', [
    field('Subtype', select(options, relation.subtypeId, (value) =>
      update('Change subtype', (target) => {
        target.subtypeId = value;
      }),
    )),
    field('Supertype', select(options, relation.supertypeId, (value) =>
      update('Change supertype', (target) => {
        target.supertypeId = value;
      }),
    )),
    checkbox('Preferred identification path', !!relation.isPreferredIdentificationPath, (value) =>
      update('Toggle identification path', (target) => {
        target.isPreferredIdentificationPath = value || undefined;
      }),
    ),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Verbalization / relational / problems                                       */
/* -------------------------------------------------------------------------- */

function renderVerbalization(host: PanelHost): HTMLElement {
  const groups = verbalizeModel(host.model, { mode: host.settings.verbalizationMode });
  if (!groups.length) return h('p', { class: 'hint', text: 'Nothing to verbalize yet.' });
  return h(
    'div',
    { class: 'verbalization' },
    groups
      .filter((group) => group.lines.length)
      .map((group) =>
        h('div', { class: 'verbalization-group' }, [
          h('h3', {
            class: `group-title${host.selection.has(group.id) ? ' selected' : ''}`,
            text: group.title,
            onclick: () => host.select(group.id, { reveal: true }),
          }),
          h(
            'ul',
            {},
            group.lines.map((line) =>
              h('li', {
                class: `verbalization-line${line.modality === 'deontic' ? ' deontic' : ''}`,
                text: line.text,
                onclick: () => host.select(line.targetId, { reveal: true }),
              }),
            ),
          ),
        ]),
      ),
  );
}

function renderRelational(host: PanelHost): HTMLElement {
  const schema = mapToRelational(host.model);
  const container = h('div', { class: 'relational' });

  container.append(
    h('div', { class: 'row' }, [
      h('button', {
        text: 'Copy DDL',
        onclick: async () => {
          const ddl = generateDdl(schema, { dialect: host.settings.ddlDialect });
          try {
            await navigator.clipboard.writeText(ddl);
            host.notify('info', 'DDL copied to the clipboard.');
          } catch {
            host.notify('error', 'Could not access the clipboard.');
          }
        },
      }),
      h('span', { class: 'hint', text: `${schema.tables.length} table(s) · ${host.settings.ddlDialect}` }),
    ]),
  );

  for (const table of schema.tables) {
    const rows = table.columns.map((column) => {
      const isKey = table.primaryKey.includes(column.name);
      const fk = table.foreignKeys.find((key) => key.columns.includes(column.name));
      return h('tr', {}, [
        h('td', { class: 'col-name' }, [
          h('span', { text: column.name }),
          isKey ? h('span', { class: 'badge pk', text: 'PK' }) : null,
          fk ? h('span', { class: 'badge fk', title: `references ${fk.refTable}`, text: 'FK' }) : null,
        ]),
        h('td', { class: 'col-type', text: column.dataType }),
        h('td', { class: 'col-null', text: column.nullable ? 'null' : 'not null' }),
      ]);
    });
    container.append(
      h('div', { class: 'table-card' }, [
        h('h3', {
          text: table.name,
          onclick: () => host.select(table.sourceId, { reveal: true }),
        }),
        h('table', {}, [h('tbody', {}, rows)]),
      ]),
    );
  }

  if (schema.notes.length) {
    container.append(
      h('div', { class: 'notes' }, [
        h('h3', { text: 'Mapping notes' }),
        h('ul', {}, schema.notes.map((note) => h('li', { text: note }))),
      ]),
    );
  }
  return container;
}

/** The labeled property graph view: node tables, relationships, and the rules the schema cannot hold. */
function renderGraph(host: PanelHost): HTMLElement {
  const schema = mapToGraph(host.model, { subtypeStrategy: host.settings.graphSubtypeStrategy });
  const container = h('div', { class: 'relational graph-schema' });

  container.append(
    h('div', { class: 'row' }, [
      h('button', {
        text: 'Copy Cypher',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(generateGraphDdl(schema));
            host.notify('info', 'LadybugDB schema copied to the clipboard.');
          } catch {
            host.notify('error', 'Could not access the clipboard.');
          }
        },
      }),
      h('span', {
        class: 'hint',
        text: `${schema.nodeTables.length} node table(s) · ${schema.relTables.length} relationship table(s) · LadybugDB`,
      }),
    ]),
  );

  for (const node of schema.nodeTables) {
    const rows = node.properties.map((property) =>
      h('tr', {}, [
        h('td', { class: 'col-name' }, [
          h('span', { text: property.name }),
          property.isPrimaryKey ? h('span', { class: 'badge pk', text: 'PK' }) : null,
          property.isRequired && !property.isPrimaryKey
            ? h('span', { class: 'badge req', title: 'Mandatory role', text: '!' })
            : null,
        ]),
        h('td', { class: 'col-type', text: property.dataType }),
        h('td', {
          class: 'col-null',
          text: property.allowedValues?.length ? `{${rangesToText(property.allowedValues)}}` : '',
        }),
      ]),
    );
    container.append(
      h('div', { class: 'table-card' }, [
        h('h3', {}, [
          h('span', { text: node.name }),
          node.isReified ? h('span', { class: 'badge reified', title: 'Reified fact type', text: 'fact' }) : null,
        ]),
        h('table', {}, [h('tbody', {}, rows)]),
      ]),
    );
    const heading = container.lastElementChild?.querySelector('h3');
    heading?.addEventListener('click', () => host.select(node.sourceId, { reveal: true }));
  }

  if (schema.relTables.length) {
    container.append(
      h('div', { class: 'table-card' }, [
        h('h3', { text: 'Relationships' }),
        h(
          'table',
          {},
          [
            h(
              'tbody',
              {},
              schema.relTables.flatMap((rel) =>
                rel.pairs.map((pair, position) =>
                  h('tr', { class: 'rel-row', onclick: () => host.select(rel.sources[0].id, { reveal: true }) }, [
                    h('td', { class: 'col-name', text: position === 0 ? rel.name : '' }),
                    h('td', { class: 'col-type', text: `${pair.from} → ${pair.to}` }),
                    h('td', {
                      class: 'col-null',
                      title: rel.multiplicity,
                      text: multiplicityLabel(rel.multiplicity),
                    }),
                  ]),
                ),
              ),
            ),
          ],
        ),
      ]),
    );
  }

  if (schema.unenforced.length) {
    container.append(
      h('div', { class: 'notes' }, [
        h('h3', { text: 'Not enforced by the schema' }),
        h(
          'ul',
          {},
          schema.unenforced.map((constraint) =>
            h('li', {
              class: 'unenforced',
              text: constraint.text,
              onclick: () => host.select(constraint.constraintId, { reveal: true }),
            }),
          ),
        ),
      ]),
    );
  }

  if (schema.notes.length) {
    container.append(
      h('div', { class: 'notes' }, [
        h('h3', { text: 'Mapping notes' }),
        h('ul', {}, schema.notes.map((note) => h('li', { text: note }))),
      ]),
    );
  }
  return container;
}

/** `MANY_ONE` reads as `N:1`; the LadybugDB keyword stays in the tooltip. */
function multiplicityLabel(multiplicity: Multiplicity): string {
  switch (multiplicity) {
    case 'ONE_ONE':
      return '1:1';
    case 'ONE_MANY':
      return '1:N';
    case 'MANY_ONE':
      return 'N:1';
    case 'MANY_MANY':
      return 'N:N';
  }
}

function renderProblems(host: PanelHost): HTMLElement {
  if (!host.issues.length) return h('p', { class: 'hint', text: 'No problems found.' });
  return h(
    'ul',
    { class: 'problems' },
    host.issues.map((issue) =>
      h('li', { class: `problem ${issue.severity}`, onclick: () => host.select(issue.elementId, { reveal: true }) }, [
        h('span', { class: 'problem-icon', text: issue.severity === 'error' ? '✖' : issue.severity === 'warning' ? '⚠' : 'ℹ' }),
        h('span', { class: 'problem-message', text: issue.message }),
        h('span', { class: 'problem-code', text: issue.code }),
      ]),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Small widgets                                                               */
/* -------------------------------------------------------------------------- */

function section(title: string, children: HTMLElement[]): HTMLElement {
  return h('section', { class: 'panel-section' }, [h('h2', { text: title }), ...children]);
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, [
    h('span', { class: 'field-label', text: label }),
    control,
    hint ? h('span', { class: 'field-hint', text: hint }) : null,
  ]);
}

function textInput(value: string, onChange: (value: string) => void): HTMLElement {
  return h('input', {
    type: 'text',
    value,
    onchange: (event: Event) => onChange((event.target as HTMLInputElement).value),
  });
}

function textArea(value: string, onChange: (value: string) => void): HTMLElement {
  const node = h('textarea', {
    rows: 3,
    onchange: (event: Event) => onChange((event.target as HTMLTextAreaElement).value),
  });
  node.value = value;
  return node;
}

function numberInput(value: number | undefined, onChange: (value: number | undefined) => void): HTMLElement {
  return h('input', {
    type: 'number',
    value: value === undefined ? '' : String(value),
    onchange: (event: Event) => {
      const raw = (event.target as HTMLInputElement).value;
      onChange(raw === '' ? undefined : Number(raw));
    },
  });
}

function checkbox(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  return h('label', { class: 'checkbox' }, [
    h('input', {
      type: 'checkbox',
      checked,
      onchange: (event: Event) => onChange((event.target as HTMLInputElement).checked),
    }),
    h('span', { text: label }),
  ]);
}

function select(
  options: [string, string][],
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const node = h('select', {
    onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value),
  });
  for (const [optionValue, label] of options) {
    const option = h('option', { value: optionValue, text: label });
    if (optionValue === value) option.selected = true;
    node.append(option);
  }
  return node;
}

/* -------------------------------------------------------------------------- */
/* Text helpers                                                                */
/* -------------------------------------------------------------------------- */

export function rangesToText(ranges: ValueRange[]): string {
  return ranges
    .map((range) => {
      if (range.value !== undefined) return typeof range.value === 'number' ? String(range.value) : `'${range.value}'`;
      const min = range.min !== undefined ? String(range.min) : '';
      const max = range.max !== undefined ? String(range.max) : '';
      return `${min}..${max}`;
    })
    .join(', ');
}

/** Parses `'M', 'F'`, `1..10`, `18..` into value ranges. */
export function parseRanges(text: string): ValueRange[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const range = part.match(/^(.*?)\.\.(.*)$/);
      if (range) {
        const [, rawMin, rawMax] = range;
        const result: ValueRange = {};
        if (rawMin.trim()) result.min = coerce(rawMin.trim());
        if (rawMax.trim()) result.max = coerce(rawMax.trim());
        return result;
      }
      return { value: coerce(part) };
    })
    .filter((range) => Object.keys(range).length > 0);
}

function coerce(raw: string): string | number {
  const unquoted = raw.replace(/^['"]|['"]$/g, '');
  if (unquoted !== raw) return unquoted;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && raw.trim() !== '' ? parsed : raw;
}

function rolePlayerName(model: OrmModel, roleId: Id): string {
  for (const ft of model.factTypes) {
    const role = ft.roles.find((r) => r.id === roleId);
    if (!role) continue;
    if (!role.objectTypeId) return '?';
    return model.objectTypes.find((o) => o.id === role.objectTypeId)?.name ?? '?';
  }
  return '?';
}

function readingOf(ft: FactType): string {
  const reading = primaryReading(ft);
  return reading ? reading.text.replace(/\{\d+\}/g, '…') : ft.id;
}

function describeConstrainedRoles(model: OrmModel, constraint: Constraint): string {
  const roles =
    constraint.kind === 'subset' || constraint.kind === 'exclusion' || constraint.kind === 'equality'
      ? constraint.roleSequences.flat()
      : (constraint as { roles?: Id[] }).roles ?? [];
  if (!roles.length) return 'Not attached to any role.';
  return `Constrains: ${roles.map((id) => rolePlayerName(model, id)).join(', ')}`;
}

function suggestObjectificationName(model: OrmModel, readingText: string): string {
  const base =
    readingText
      .replace(/\{\d+\}/g, ' ')
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .trim()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('') || 'Fact';
  let name = base;
  let suffix = 2;
  while (model.objectTypes.some((o) => o.name === name)) {
    name = `${base}${suffix}`;
    suffix += 1;
  }
  return name;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
