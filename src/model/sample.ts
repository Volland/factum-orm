import { OrmModel } from './types.js';

/**
 * The model created by "New ORM Model": a small, complete schema that shows a
 * reference mode, a functional binary, an m:n binary, a subtype and a value
 * constraint, so the diagram is never empty on first open.
 */
export function sampleModel(name = 'New Model'): OrmModel {
  return {
    version: 1,
    name,
    objectTypes: [
      { id: 'ot_person', name: 'Person', kind: 'entity', refMode: 'nr', dataType: 'integer', isPersonal: true },
      { id: 'ot_company', name: 'Company', kind: 'entity', refMode: 'name', dataType: 'string' },
      { id: 'ot_skill', name: 'Skill', kind: 'entity', refMode: 'code', dataType: 'string' },
      { id: 'ot_gender', name: 'GenderCode', kind: 'value', dataType: 'string', dataTypeLength: 1 },
      { id: 'ot_manager', name: 'Manager', kind: 'entity' },
    ],
    factTypes: [
      {
        id: 'ft_works',
        roles: [
          { id: 'r_works_person', objectTypeId: 'ot_person' },
          { id: 'r_works_company', objectTypeId: 'ot_company' },
        ],
        readings: [
          { id: 'rd_works', roleOrder: ['r_works_person', 'r_works_company'], text: '{0} works for {1}', isPrimary: true },
          { id: 'rd_works_inv', roleOrder: ['r_works_company', 'r_works_person'], text: '{0} employs {1}' },
        ],
      },
      {
        id: 'ft_gender',
        roles: [
          { id: 'r_gender_person', objectTypeId: 'ot_person' },
          { id: 'r_gender_value', objectTypeId: 'ot_gender' },
        ],
        readings: [
          { id: 'rd_gender', roleOrder: ['r_gender_person', 'r_gender_value'], text: '{0} is of {1}', isPrimary: true },
        ],
      },
      {
        id: 'ft_skill',
        roles: [
          { id: 'r_skill_person', objectTypeId: 'ot_person' },
          { id: 'r_skill_skill', objectTypeId: 'ot_skill' },
        ],
        readings: [
          { id: 'rd_skill', roleOrder: ['r_skill_person', 'r_skill_skill'], text: '{0} has {1}', isPrimary: true },
        ],
      },
    ],
    subtypeRelations: [
      { id: 'st_manager', subtypeId: 'ot_manager', supertypeId: 'ot_person', isPreferredIdentificationPath: true },
    ],
    constraints: [
      { id: 'uc_works', kind: 'uniqueness', roles: ['r_works_person'] },
      { id: 'mc_works', kind: 'mandatory', roles: ['r_works_person'] },
      { id: 'uc_gender', kind: 'uniqueness', roles: ['r_gender_person'] },
      { id: 'mc_gender', kind: 'mandatory', roles: ['r_gender_person'] },
      { id: 'uc_skill', kind: 'uniqueness', roles: ['r_skill_person', 'r_skill_skill'] },
      {
        id: 'vc_gender',
        kind: 'value',
        objectTypeId: 'ot_gender',
        ranges: [{ value: 'M' }, { value: 'F' }],
      },
    ],
    diagram: {
      shapes: {
        ot_person: { x: 120, y: 200 },
        ot_company: { x: 420, y: 120 },
        ot_skill: { x: 420, y: 300 },
        ot_gender: { x: 120, y: 360 },
        ot_manager: { x: 120, y: 60 },
        ft_works: { x: 290, y: 150, orientation: 'horizontal' },
        ft_gender: { x: 155, y: 300, orientation: 'vertical' },
        ft_skill: { x: 290, y: 320, orientation: 'horizontal' },
      },
    },
  };
}
