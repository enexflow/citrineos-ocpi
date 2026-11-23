// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import {
  OnboardRoamingNetworkCpoBodySchema,
  OnboardRoamingNetworkEmspBodySchema,
  OnboardRoamingPartnerEmspBodySchema,
  OnboardTenantPartnerEmspBodySchema,
} from '../OnboardRoamingPartnerBody';

const identity = {
  ourCountryCode: 'FR',
  ourPartyId: 'ZTA',
  partnerCountryCode: 'FR',
  partnerPartyId: 'HUB',
  roamingPartnerCountryCode: 'FR',
  roamingPartnerPartyId: 'TTF',
  roamingPartnerName: 'Transports Test Florianne',
  roamingPartnerSignatureDate: '2026-01-15',
  roamingPartnerContractStartDate: '2026-02-01',
};

const billing = {
  paymentConditions: '30_days',
  emails: [
    'compta@transports-demo.example',
    'facturation@transports-demo.example',
  ],
  billingAddress: {
    address: "12 rue de l'Exemple",
    postalCode: '69003',
    city: 'Lyon',
    countryAlpha2: 'FR',
  },
  vatNumber: 'FR32123456789',
  regNo: '123456789',
  phone: '+33 4 00 00 00 00',
  recipient: 'Service Comptabilité',
  billingIban: 'FR7630006000011234567890189',
  notes: 'Fake customer created for local testing',
  billingLanguage: 'fr_FR',
};

const OPTIONAL_BILLING_FIELDS = [
  'regNo',
  'phone',
  'recipient',
  'billingIban',
  'notes',
];
const requiredBillingFields = Object.keys(billing).filter(
  (field) => !OPTIONAL_BILLING_FIELDS.includes(field),
);

const validBody = { ...identity, ...billing, contractNb: 'GIR-2026-001' };

const issuePaths = (body: unknown) => {
  const result = OnboardRoamingPartnerEmspBodySchema.safeParse(body);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('OnboardRoamingPartnerEmspBodySchema', () => {
  it('accepts a full body without reference fields', () => {
    expect(issuePaths(validBody)).toEqual([]);
  });

  it('accepts the optional reference fields', () => {
    expect(
      issuePaths({
        ...validBody,
        reference: 'ACME-001',
        externalReference: 'patterm-company-1234',
      }),
    ).toEqual([]);
  });

  it.each(requiredBillingFields)('requires %s', (field) => {
    const body: Record<string, unknown> = { ...validBody };
    delete body[field];

    expect(issuePaths(body)).toEqual([field]);
  });

  it('accepts a body without any optional billing field', () => {
    const body: Record<string, unknown> = { ...validBody };
    OPTIONAL_BILLING_FIELDS.forEach((field) => delete body[field]);

    expect(issuePaths(body)).toEqual([]);
  });

  it.each(['address', 'postalCode', 'city', 'countryAlpha2'])(
    'requires billingAddress.%s',
    (field) => {
      const billingAddress: Record<string, unknown> = {
        ...billing.billingAddress,
      };
      delete billingAddress[field];

      expect(issuePaths({ ...validBody, billingAddress })).toEqual([
        `billingAddress.${field}`,
      ]);
    },
  );

  it.each([
    ['paymentConditions', '45_days'],
    ['emails', []],
    ['emails', ['not-an-email']],
    ['vatNumber', '32123456789'],
    ['phone', 'call me'],
    ['billingIban', 'FR76 3000 6000 0112 3456 7890 189'],
    ['billingLanguage', 'fr'],
    ['notes', '   '],
  ])('rejects an invalid %s (%j)', (field, value) => {
    expect(issuePaths({ ...validBody, [field]: value })[0]).toMatch(
      new RegExp(`^${field}`),
    );
  });

  it.each([[undefined], ['   ']])(
    'requires a contractNb (%j)',
    (contractNb) => {
      expect(issuePaths({ ...validBody, contractNb })).toEqual(['contractNb']);
    },
  );

  it('still requires the roaming partner identity', () => {
    const { roamingPartnerName: _omitted, ...body } = validBody;

    expect(issuePaths(body)).toEqual(['roamingPartnerName']);
  });
});

describe('OnboardTenantPartnerEmspBodySchema', () => {
  const tenantBody = {
    ourCountryCode: 'FR',
    ourPartyId: 'ZET',
    partnerCountryCode: 'FR',
    partnerPartyId: 'MSP',
    tenantPartnerName: 'Transports Test Florianne',
    ...billing,
  };

  const tenantIssuePaths = (body: unknown) => {
    const result = OnboardTenantPartnerEmspBodySchema.safeParse(body);
    return result.success
      ? []
      : result.error.issues.map((issue) => issue.path.join('.'));
  };

  it('accepts the tenant partner identity + billing, without any roaming partner field', () => {
    expect(tenantIssuePaths(tenantBody)).toEqual([]);
  });

  it.each([
    'ourCountryCode',
    'ourPartyId',
    'partnerCountryCode',
    'partnerPartyId',
    'tenantPartnerName',
    ...requiredBillingFields,
  ])('requires %s', (field) => {
    const body: Record<string, unknown> = { ...tenantBody };
    delete body[field];

    expect(tenantIssuePaths(body)).toEqual([field]);
  });

  it('applies the same billing rules as the roaming partner body', () => {
    expect(
      tenantIssuePaths({ ...tenantBody, paymentConditions: '45_days' }),
    ).toEqual(['paymentConditions']);
  });
});

describe('network onboarding schemas', () => {
  const {
    roamingPartnerCountryCode: _cc,
    roamingPartnerPartyId: _pid,
    ...networkIdentity
  } = identity;
  const operations = [
    {
      'Operation Emi3': 'FR*S13',
      'Operation Name': 'GreenFlux Assets B.V. | FR*S13',
      'Operation Owner': 'GreenFlux Assets B.V.',
    },
    {
      'Operation Emi3': 'NL*EVN',
      'Operation Name': 'Evnet.nl | NL*EVN',
      'Operation Owner': 'GreenFlux Assets B.V.',
    },
  ];
  const cpoBody = {
    ...networkIdentity,
    roamingPartnerName: 'GreenFlux',
    operationOwner: 'GreenFlux Assets B.V.',
    operations,
  };
  const emspBody = { ...cpoBody, ...billing, contractNb: 'GIR-2026-001' };

  const cpoIssuePaths = (body: unknown) => {
    const result = OnboardRoamingNetworkCpoBodySchema.safeParse(body);
    return result.success
      ? []
      : result.error.issues.map((issue) => issue.path.join('.'));
  };
  const emspIssuePaths = (body: unknown) => {
    const result = OnboardRoamingNetworkEmspBodySchema.safeParse(body);
    return result.success
      ? []
      : result.error.issues.map((issue) => issue.path.join('.'));
  };

  it('accepts the hub export rows as converted from the CSV', () => {
    expect(cpoIssuePaths(cpoBody)).toEqual([]);
    expect(emspIssuePaths(emspBody)).toEqual([]);
  });

  it('accepts rows with only "Operation Emi3", without operationOwner', () => {
    const { operationOwner: _owner, ...body } = cpoBody;

    expect(
      cpoIssuePaths({
        ...body,
        operations: [{ 'Operation Emi3': 'FR*190' }],
        forcePull: true,
      }),
    ).toEqual([]);
  });

  it('does not take roaming partner identity fields', () => {
    const result = OnboardRoamingNetworkCpoBodySchema.safeParse({
      ...cpoBody,
      roamingPartnerCountryCode: 'FR',
      roamingPartnerPartyId: 'S13',
    });

    expect(result.success && 'roamingPartnerPartyId' in result.data).toBe(
      false,
    );
  });

  it.each(['FRS13', 'FR*S1', 'fr*S13', 'FR*S13X', 'FR-S13'])(
    'rejects the operation id %j',
    (id) => {
      expect(
        cpoIssuePaths({ ...cpoBody, operations: [{ 'Operation Emi3': id }] }),
      ).toEqual(['operations.0.Operation Emi3']);
    },
  );

  it('rejects an empty operation list', () => {
    expect(cpoIssuePaths({ ...cpoBody, operations: [] })).toEqual([
      'operations',
    ]);
  });

  it('rejects a duplicate operation', () => {
    expect(
      cpoIssuePaths({
        ...cpoBody,
        operations: [...operations, { 'Operation Emi3': 'FR*S13' }],
      }),
    ).toEqual(['operations.2.Operation Emi3']);
  });

  it.each(['roamingPartnerName', 'roamingPartnerSignatureDate', 'ourPartyId'])(
    'requires %s',
    (field) => {
      const body: Record<string, unknown> = { ...cpoBody };
      delete body[field];

      expect(cpoIssuePaths(body)).toEqual([field]);
    },
  );

  it.each([...requiredBillingFields, 'contractNb'])(
    'requires %s on the EMSP network body',
    (field) => {
      const body: Record<string, unknown> = { ...emspBody };
      delete body[field];

      expect(emspIssuePaths(body)).toEqual([field]);
    },
  );

  it('accepts an EMSP network body without the optional billing fields', () => {
    const body: Record<string, unknown> = { ...emspBody };
    OPTIONAL_BILLING_FIELDS.forEach((field) => delete body[field]);

    expect(emspIssuePaths(body)).toEqual([]);
  });
});
