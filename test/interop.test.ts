import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportFbmFile, importFbmFile } from '../src/io/fbm.js';
import { detectFormat } from '../src/io/interop.js';
import { exportNormaFile } from '../src/io/normaExport.js';
import { importNormaFile } from '../src/io/normaImport.js';
import { exportOssieFile, importOssieFile } from '../src/io/ossie.js';
import { exportUmsFile, importUmsFile } from '../src/io/ums.js';
import { primaryReading } from '../src/model/model.js';
import { sampleModel } from '../src/model/sample.js';
import { Constraint, OrmModel } from '../src/model/types.js';

/** The counts a conceptual round trip has to preserve. */
function shape(model: OrmModel): Record<string, number> {
  const out: Record<string, number> = {
    objectTypes: model.objectTypes.length,
    factTypes: model.factTypes.length,
    subtypeRelations: model.subtypeRelations.length,
  };
  for (const c of model.constraints) out[c.kind] = (out[c.kind] ?? 0) + 1;
  return out;
}

function readingTexts(model: OrmModel): string[] {
  return model.factTypes.map((ft) => primaryReading(ft)?.text ?? '').sort();
}

/* -------------------------------------------------------------------------- */
/* FBM                                                                         */
/* -------------------------------------------------------------------------- */

const FBM_BINARY = `<?xml version="1.0" encoding="utf-8"?>
<Model XSDVersionNr="1.7">
  <ORMModel ModelId="m1" Name="Hire" CoreVersionNumber="2.6">
    <ValueTypes>
      <ValueType Id="vt_nr" GUID="_VT" Name="PersonNr" DataType="NumericSignedInteger"
                 DataTypePrecision="0" DataTypeLength="0" IsIndependent="false"
                 LongDescription="The number." ShortDescription="Nr" />
    </ValueTypes>
    <EntityTypes>
      <EntityType Id="et_person" GUID="_ET" Name="Person" ReferenceMode=".nr" HideReferenceMode="true"
                  IsIndependent="false" IsPersonal="true" IsAbsorbed="false" IsDerived="false" />
      <EntityType Id="et_company" Name="Company" HideReferenceMode="false"
                  IsIndependent="false" IsPersonal="false" IsAbsorbed="false" IsDerived="false" />
    </EntityTypes>
    <FactTypes>
      <FactType Id="ft_works" Name="PersonWorksForCompany" IsObjectified="false"
                IsSubtypeRelationshipFactType="false" IsDerived="false" IsStored="false">
        <RoleGroup>
          <Role Id="r1" Name="" SequenceNr="1" Mandatory="true" JoinedObjectTypeId="et_person" />
          <Role Id="r2" Name="" SequenceNr="2" Mandatory="false" JoinedObjectTypeId="et_company" />
        </RoleGroup>
        <FactTypeReadings>
          <FactTypeReading Id="rd1" FrontReadingText="" FollowingReadingText="">
            <PredicateParts>
              <PredicatePart SequenceNr="1" Role_Id="r1"><PredicatePartText>works for</PredicatePartText></PredicatePart>
              <PredicatePart SequenceNr="2" Role_Id="r2"><PredicatePartText /></PredicatePart>
            </PredicateParts>
          </FactTypeReading>
        </FactTypeReadings>
      </FactType>
    </FactTypes>
    <RoleConstraints>
      <RoleConstraint Id="uc1" Name="UC1" RoleConstraintType="InternalUniquenessConstraint"
                      RingConstraintType="None" IsPreferredUniqueness="false" IsDeontic="false"
                      MinimumFrequencyCount="0" MaximumFrequencyCount="0" Cardinality="0">
        <RoleConstraintRoles>
          <RoleConstraintRole RoleId="r1" SequenceNr="1" />
        </RoleConstraintRoles>
      </RoleConstraint>
    </RoleConstraints>
  </ORMModel>
</Model>`;

// @lat: [[tests#Interchange#FBM predicate parts become placeholder readings]]
test('FBM predicate parts are read back as placeholder readings', () => {
  const { model } = importFbmFile(FBM_BINARY);
  assert.equal(model.name, 'Hire');
  const works = model.factTypes[0];
  assert.equal(primaryReading(works)?.text, '{0} works for {1}');
  assert.deepEqual(primaryReading(works)?.roleOrder, ['r1', 'r2']);
});

// @lat: [[tests#Interchange#FBM mandatory roles become mandatory constraints]]
test('a mandatory FBM role becomes a mandatory constraint', () => {
  const { model } = importFbmFile(FBM_BINARY);
  const mandatory = model.constraints.filter((c) => c.kind === 'mandatory');
  assert.equal(mandatory.length, 1);
  assert.deepEqual((mandatory[0] as Extract<Constraint, { kind: 'mandatory' }>).roles, ['r1']);
});

// @lat: [[tests#Interchange#FBM descriptions and guids reach meta]]
test('FBM GUIDs and descriptions are carried into meta', () => {
  const { model } = importFbmFile(FBM_BINARY);
  const nr = model.objectTypes.find((o) => o.name === 'PersonNr');
  assert.equal(nr?.meta?.guid, '_VT');
  assert.equal(nr?.meta?.description, 'The number.');
  assert.equal(nr?.meta?.shortDescription, 'Nr');
  assert.equal(nr?.dataType, 'integer');
  assert.equal(model.objectTypes.find((o) => o.name === 'Person')?.refMode, 'nr');
});

// @lat: [[tests#Interchange#A model survives an FBM round trip]]
test('a model survives an export to FBM and back', () => {
  const model = sampleModel();
  const { text, warnings } = exportFbmFile(model);
  assert.deepEqual(warnings, []);
  const back = importFbmFile(text).model;
  assert.deepEqual(shape(back), shape(model));
  assert.deepEqual(readingTexts(back), readingTexts(model));
});

// @lat: [[tests#Interchange#FBM boolean attributes keep their value]]
test('FBM boolean attributes are written with a value, not as bare flags', () => {
  const { text } = exportFbmFile(sampleModel());
  assert.match(text, /Mandatory="true"/);
  assert.doesNotMatch(text, /Mandatory[ />]/);
});

// @lat: [[tests#Interchange#FBM composite ring types are split]]
test('a composite FBM ring type is split into its parts', () => {
  const xml = FBM_BINARY.replace(
    '<RoleConstraint Id="uc1" Name="UC1" RoleConstraintType="InternalUniquenessConstraint"\n                      RingConstraintType="None"',
    '<RoleConstraint Id="rc1" Name="RC1" RoleConstraintType="RingConstraint"\n                      RingConstraintType="AsymmetricIntransitive"',
  ).replace('<RoleConstraintRole RoleId="r1" SequenceNr="1" />',
            '<RoleConstraintRole RoleId="r1" SequenceNr="1" /><RoleConstraintRole RoleId="r2" SequenceNr="2" />');
  const ring = importFbmFile(xml).model.constraints.find((c) => c.kind === 'ring');
  assert.ok(ring, 'expected a ring constraint');
  assert.deepEqual((ring as Extract<Constraint, { kind: 'ring' }>).types, ['asymmetric', 'intransitive']);
});

/* -------------------------------------------------------------------------- */
/* Ossie                                                                       */
/* -------------------------------------------------------------------------- */

const OSSIE_ONTOLOGY = `version: 0.2.0.dev0
name: Hire
ontology:
- concept: NrDollars
  type: ValueType
  extends: [ Decimal ]
- concept: Salary
  type: ValueType
  extends: [ NrDollars ]
- concept: PersonNr
  type: ValueType
  extends: [ Integer ]
  requires: [ "0 < PersonNr" ]
- concept: GenderCode
  type: ValueType
  extends: [ String ]
  requires: [ "GenderCode == 'M' OR GenderCode == 'F'" ]
- concept: Person
  type: EntityType
  identify_by: [ nr ]
  relationships:
  - name: nr
    roles:
    - concept: PersonNr
    multiplicity: OneToOne
    verbalizes: [ '{Person} is identified by {PersonNr}' ]
  - name: earns
    roles:
    - concept: Salary
    multiplicity: ManyToOne
    verbalizes: [ '{Person} earns {Salary}' ]
  - name: manages
    roles:
    - concept: Person
      name: report
    verbalizes: [ '{Person} manages {Person:report}' ]
- concept: Employee
  type: EntityType
  extends: [ Person ]
`;

// @lat: [[tests#Interchange#Ossie verbalizations become placeholder readings]]
test('Ossie verbalizations are read back as placeholder readings', () => {
  const { model, warnings } = importOssieFile(OSSIE_ONTOLOGY);
  assert.deepEqual(warnings, []);
  const texts = readingTexts(model);
  assert.ok(texts.includes('{0} earns {1}'), texts.join(' | '));
  // A concept playing two roles is disambiguated by its role name.
  assert.ok(texts.includes('{0} manages {1}'), texts.join(' | '));
});

// @lat: [[tests#Interchange#Ossie multiplicity becomes uniqueness]]
test('Ossie multiplicity becomes uniqueness and identify_by a preferred identifier', () => {
  const { model } = importOssieFile(OSSIE_ONTOLOGY);
  const unique = model.constraints.filter(
    (c): c is Extract<Constraint, { kind: 'uniqueness' }> => c.kind === 'uniqueness',
  );
  // `nr` is OneToOne: unique on both roles. `earns` is ManyToOne: unique on one.
  assert.equal(unique.filter((c) => c.isPreferredIdentifier).length, 1);
  assert.ok(unique.length >= 3, `expected at least three uniqueness constraints, got ${unique.length}`);
  // `manages` has no multiplicity, so it stays many-to-many.
  const manages = model.factTypes.find((f) => primaryReading(f)?.text === '{0} manages {1}');
  assert.ok(manages);
  assert.ok(!unique.some((c) => manages.roles.some((r) => c.roles.includes(r.id))));
});

// @lat: [[tests#Interchange#Ossie extends resolves data types and subtyping]]
test('Ossie extends resolves a data type through the chain and subtypes entity types', () => {
  const { model } = importOssieFile(OSSIE_ONTOLOGY);
  // Salary extends NrDollars extends Decimal.
  assert.equal(model.objectTypes.find((o) => o.name === 'Salary')?.dataType, 'decimal');
  const subtype = model.subtypeRelations.map((s) => [
    model.objectTypes.find((o) => o.id === s.subtypeId)?.name,
    model.objectTypes.find((o) => o.id === s.supertypeId)?.name,
  ]);
  assert.ok(subtype.some(([a, b]) => a === 'Employee' && b === 'Person'), JSON.stringify(subtype));
  assert.ok(subtype.some(([a, b]) => a === 'Salary' && b === 'NrDollars'), JSON.stringify(subtype));
});

// @lat: [[tests#Interchange#Ossie requires expressions become value constraints]]
test('Ossie requires expressions become value constraints where they can', () => {
  const { model } = importOssieFile(OSSIE_ONTOLOGY);
  const gender = model.objectTypes.find((o) => o.name === 'GenderCode');
  const values = model.constraints.find(
    (c): c is Extract<Constraint, { kind: 'value' }> => c.kind === 'value' && c.objectTypeId === gender?.id,
  );
  assert.deepEqual(values?.ranges, [{ value: 'M' }, { value: 'F' }]);

  const nr = model.objectTypes.find((o) => o.name === 'PersonNr');
  const bound = model.constraints.find(
    (c): c is Extract<Constraint, { kind: 'value' }> => c.kind === 'value' && c.objectTypeId === nr?.id,
  );
  assert.deepEqual(bound?.ranges, [{ min: 0, minInclusive: false }]);
});

// @lat: [[tests#Interchange#An ontology survives an Ossie round trip]]
test('an ontology survives an export to Ossie and back', () => {
  const model = importOssieFile(OSSIE_ONTOLOGY).model;
  const { text } = exportOssieFile(model);
  const back = importOssieFile(text).model;
  assert.deepEqual(shape(back), shape(model));
  assert.deepEqual(readingTexts(back), readingTexts(model));
});

// @lat: [[tests#Interchange#Ossie export reports what it cannot carry]]
test('exporting to Ossie warns about objectification it cannot carry', () => {
  const model = sampleModel();
  const objectified = model.objectTypes.find((o) => o.name === 'Person');
  assert.ok(objectified);
  objectified.objectifiedFactTypeId = model.factTypes[0].id;
  const { warnings } = exportOssieFile(model);
  assert.ok(warnings.some((w) => w.includes('objectifies')), warnings.join(' | '));
});

/* -------------------------------------------------------------------------- */
/* UMS                                                                         */
/* -------------------------------------------------------------------------- */

// @lat: [[tests#Interchange#UMS export produces types with properties]]
test('exporting to UMS produces types with properties, keys and relationships', () => {
  const { text } = exportUmsFile(sampleModel());
  assert.match(text, /Name: New Model/);
  assert.match(text, /UMSVersionNr: ["']?0\.1["']?/);
  assert.match(text, /- Type: Person/);
  assert.match(text, /PrimaryKey:/);
  assert.match(text, /IsRelationshipType: false/);
  // Readings survive as the fact-based annotation UMS keeps on properties.
  assert.match(text, /Person works for Company/);
});

// @lat: [[tests#Interchange#UMS import warns that it is a logical schema]]
test('importing UMS produces a model and says it is a logical schema', () => {
  const { text } = exportUmsFile(sampleModel());
  const { model, warnings } = importUmsFile(text);
  assert.ok(model.objectTypes.length > 0);
  assert.ok(model.factTypes.length > 0);
  assert.ok(warnings.some((w) => w.includes('logical schema')), warnings.join(' | '));
  // Every entity type from the export comes back.
  assert.ok(model.objectTypes.some((o) => o.name === 'Person'));
});

/* -------------------------------------------------------------------------- */
/* NORMA                                                                       */
/* -------------------------------------------------------------------------- */

// @lat: [[tests#Interchange#A model survives a NORMA round trip]]
test('a model survives an export to NORMA and back', () => {
  const model = sampleModel();
  const { text } = exportNormaFile(model);
  assert.match(text, /ormRoot:ORM2/);
  const back = importNormaFile(text).model;
  assert.deepEqual(shape(back), shape(model));
  assert.deepEqual(readingTexts(back), readingTexts(model));
});

// @lat: [[tests#Interchange#NORMA value constraints are nested where the importer reads them]]
test('NORMA value constraints are written where the importer reads them', () => {
  const { text } = exportNormaFile(sampleModel());
  assert.match(text, /ValueRestriction/);
  const back = importNormaFile(text).model;
  const values = back.constraints.filter((c) => c.kind === 'value');
  assert.equal(values.length, 1);
});

/* -------------------------------------------------------------------------- */
/* Detection                                                                   */
/* -------------------------------------------------------------------------- */

// @lat: [[tests#Interchange#The format of a document is detected]]
test('the format of an interchange document is detected from its name and content', () => {
  assert.equal(detectFormat('a.fbm', ''), 'fbm');
  assert.equal(detectFormat('a.orm', ''), 'norma');
  // Both YAML formats share an extension, so the content decides.
  assert.equal(detectFormat('a.yaml', 'ontology:\n- concept: X\n'), 'ossie');
  assert.equal(detectFormat('a.yaml', 'ModelElement:\n- Type: X\n'), 'ums');
  assert.equal(detectFormat('a.yaml', 'nothing: here\n'), undefined);
  // An unhelpful extension still leaves the root element.
  assert.equal(detectFormat('a.xml', FBM_BINARY), 'fbm');
  assert.equal(detectFormat('a.txt', OSSIE_ONTOLOGY), 'ossie');
});
