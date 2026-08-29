import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importNormaFile } from '../src/io/normaImport.js';
import { validateModel } from '../src/core/validate.js';
import { verbalizeModel } from '../src/core/verbalize.js';

const NORMA_XML = `<?xml version="1.0" encoding="utf-8"?>
<ormRoot:ORM2 xmlns:orm="http://schemas.neumont.edu/ORM/2006-04/ORMCore"
              xmlns:ormDiagram="http://schemas.neumont.edu/ORM/2006-04/ORMDiagram"
              xmlns:ormRoot="http://schemas.neumont.edu/ORM/2006-04/ORMRoot">
  <orm:ORMModel id="_M1" Name="HR">
    <orm:Objects>
      <orm:EntityType id="_Person" Name="Person" _ReferenceMode="nr">
        <orm:ConceptualDataType id="_cdt1" ref="_dtInt" Scale="0" Length="0"/>
        <orm:PreferredIdentifier ref="_UC1"/>
      </orm:EntityType>
      <orm:EntityType id="_Company" Name="Company" _ReferenceMode="name"/>
      <orm:ValueType id="_Gender" Name="GenderCode">
        <orm:ConceptualDataType id="_cdt2" ref="_dtText" Scale="0" Length="1"/>
        <orm:ValueRestriction>
          <orm:ValueConstraint id="_VC1" Name="GenderValues">
            <orm:ValueRanges>
              <orm:ValueRange id="_VR1" MinValue="M" MaxValue="M"/>
              <orm:ValueRange id="_VR2" MinValue="F" MaxValue="F"/>
            </orm:ValueRanges>
          </orm:ValueConstraint>
        </orm:ValueRestriction>
      </orm:ValueType>
      <orm:EntityType id="_Manager" Name="Manager"/>
    </orm:Objects>
    <orm:Facts>
      <orm:Fact id="_F1" _Name="PersonWorksForCompany">
        <orm:FactRoles>
          <orm:Role id="_R1" Name=""><orm:RolePlayer ref="_Person"/></orm:Role>
          <orm:Role id="_R2" Name=""><orm:RolePlayer ref="_Company"/></orm:Role>
        </orm:FactRoles>
        <orm:ReadingOrders>
          <orm:ReadingOrder id="_RO1">
            <orm:RoleSequence><orm:Role ref="_R1"/><orm:Role ref="_R2"/></orm:RoleSequence>
            <orm:Readings><orm:Reading id="_RD1"><orm:Data>{0} works for {1}</orm:Data></orm:Reading></orm:Readings>
          </orm:ReadingOrder>
          <orm:ReadingOrder id="_RO2">
            <orm:RoleSequence><orm:Role ref="_R2"/><orm:Role ref="_R1"/></orm:RoleSequence>
            <orm:Readings><orm:Reading id="_RD2"><orm:Data>{0} employs {1}</orm:Data></orm:Reading></orm:Readings>
          </orm:ReadingOrder>
        </orm:ReadingOrders>
      </orm:Fact>
      <orm:SubtypeFact id="_SF1" IsPrimary="true">
        <orm:FactRoles>
          <orm:SubtypeMetaRole id="_SR1"><orm:RolePlayer ref="_Manager"/></orm:SubtypeMetaRole>
          <orm:SupertypeMetaRole id="_SR2"><orm:RolePlayer ref="_Person"/></orm:SupertypeMetaRole>
        </orm:FactRoles>
      </orm:SubtypeFact>
    </orm:Facts>
    <orm:Constraints>
      <orm:UniquenessConstraint id="_UC2" Name="WorksForUC" IsInternal="true" Modality="Alethic">
        <orm:RoleSequence><orm:Role ref="_R1"/></orm:RoleSequence>
      </orm:UniquenessConstraint>
      <orm:MandatoryConstraint id="_MC1" Name="WorksForMC" IsSimple="true">
        <orm:RoleSequence><orm:Role ref="_R1"/></orm:RoleSequence>
      </orm:MandatoryConstraint>
      <orm:RingConstraint id="_RC1" Name="Reports" Type="AsymmetricIntransitive">
        <orm:RoleSequence><orm:Role ref="_R1"/><orm:Role ref="_R2"/></orm:RoleSequence>
      </orm:RingConstraint>
    </orm:Constraints>
    <orm:DataTypes>
      <orm:SignedIntegerNumericDataType id="_dtInt"/>
      <orm:VariableLengthTextDataType id="_dtText"/>
    </orm:DataTypes>
  </orm:ORMModel>
  <ormDiagram:ORMDiagram id="_D1" Name="HR Diagram">
    <ormDiagram:ObjectTypeShape id="_S1" AbsoluteBounds="1.5, 2, 0.6, 0.35">
      <ormDiagram:Subject ref="_Person"/>
    </ormDiagram:ObjectTypeShape>
    <ormDiagram:FactTypeShape id="_S2" AbsoluteBounds="3, 2.2, 0.5, 0.2" DisplayOrientation="VerticalRotatedRight">
      <ormDiagram:Subject ref="_F1"/>
    </ormDiagram:FactTypeShape>
  </ormDiagram:ORMDiagram>
</ormRoot:ORM2>`;

test('objects, reference modes and data types are imported', () => {
  const { model } = importNormaFile(NORMA_XML);
  assert.equal(model.name, 'HR');
  assert.equal(model.objectTypes.length, 4);
  const person = model.objectTypes.find((o) => o.id === '_Person')!;
  assert.equal(person.kind, 'entity');
  assert.equal(person.refMode, 'nr');
  assert.equal(person.dataType, 'integer');
  const gender = model.objectTypes.find((o) => o.id === '_Gender')!;
  assert.equal(gender.kind, 'value');
  assert.equal(gender.dataType, 'string');
  assert.equal(gender.dataTypeLength, 1);
});

test('fact types keep both reading orders and their role players', () => {
  const { model } = importNormaFile(NORMA_XML);
  const fact = model.factTypes.find((f) => f.id === '_F1')!;
  assert.deepEqual(fact.roles.map((r) => r.objectTypeId), ['_Person', '_Company']);
  assert.deepEqual(fact.readings.map((r) => r.text), ['{0} works for {1}', '{0} employs {1}']);
  assert.equal(fact.readings[0].isPrimary, true);
});

test('constraints, subtypes and value restrictions are imported', () => {
  const { model } = importNormaFile(NORMA_XML);
  const kinds = model.constraints.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ['mandatory', 'ring', 'uniqueness', 'value']);
  const ring = model.constraints.find((c) => c.kind === 'ring')!;
  assert.deepEqual(ring.kind === 'ring' ? ring.types : [], ['asymmetric', 'intransitive']);
  const value = model.constraints.find((c) => c.kind === 'value')!;
  assert.deepEqual(value.kind === 'value' ? value.ranges : [], [{ value: 'M' }, { value: 'F' }]);
  assert.deepEqual(model.subtypeRelations, [
    { id: '_SF1', subtypeId: '_Manager', supertypeId: '_Person', isPreferredIdentificationPath: true },
  ]);
});

test('diagram geometry is converted from inches and normalized', () => {
  const { model } = importNormaFile(NORMA_XML);
  const person = model.diagram.shapes['_Person'];
  assert.equal(person.x, 40);
  assert.equal(person.y, 40);
  const fact = model.diagram.shapes['_F1'];
  assert.equal(fact.orientation, 'vertical');
  assert.equal(fact.x, 40 + Math.round(1.5 * 96));
});

test('an imported model verbalizes and validates', () => {
  const { model } = importNormaFile(NORMA_XML);
  const lines = verbalizeModel(model).flatMap((g) => g.lines.map((l) => l.text));
  assert.ok(lines.includes('Each Person works for exactly one Company.'), lines.join('\n'));
  const errors = validateModel(model).filter((i) => i.severity === 'error').map((i) => i.code);
  // The ring constraint spans two different object types, which NORMA would reject too.
  assert.deepEqual(errors, ['ring-incompatible-roles']);
});

test('a non-NORMA file is rejected with a clear message', () => {
  assert.throws(() => importNormaFile('<html><body>nope</body></html>'), /no <ORMModel> element/);
});
