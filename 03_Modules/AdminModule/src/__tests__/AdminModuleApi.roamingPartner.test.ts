// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// The controller is exercised directly (no HTTP layer), so the base package's
// decorators and heavy runtime are stubbed out.
jest.mock('@citrineos/ocpi-base', () => {
  const noopDecorator = () => () => undefined;
  const stubClass = () => class {};
  return {
    AsAdminEndpoint: noopDecorator,
    OpenAPI: noopDecorator,
    BodyWithSchema: noopDecorator,
    Paginated: noopDecorator,
    BaseController: class {},
    OnboardRoamingPartnerBodySchema: {},
    OnboardRoamingPartnerBodySchemaName: 'OnboardRoamingPartnerBodySchema',
    // Validation is covered by the schema itself; the controller test only
    // checks routing, so the stub accepts any body as-is.
    OnboardRoamingPartnerEmspBodySchema: {
      safeParse: (data: unknown) => ({ success: true, data }),
    },
    OnboardRoamingPartnerEmspBodySchemaName:
      'OnboardRoamingPartnerEmspBodySchema',
    OnboardTenantPartnerEmspBodySchema: {
      safeParse: (data: unknown) => ({ success: true, data }),
    },
    OnboardTenantPartnerEmspBodySchemaName:
      'OnboardTenantPartnerEmspBodySchema',
    OnboardRoamingNetworkCpoBodySchema: {
      safeParse: (data: unknown) => ({ success: true, data }),
    },
    OnboardRoamingNetworkCpoBodySchemaName:
      'OnboardRoamingNetworkCpoBodySchema',
    OnboardRoamingNetworkEmspBodySchema: {
      safeParse: (data: unknown) => ({ success: true, data }),
    },
    OnboardRoamingNetworkEmspBodySchemaName:
      'OnboardRoamingNetworkEmspBodySchema',
    OcpiResponseStatusCode: { GenericSuccessCode: 1000 },
    DEFAULT_LIMIT: 10,
    DEFAULT_OFFSET: 0,
    GET_ALL_TENANT_PARTNERS: 'GET_ALL_TENANT_PARTNERS',
    GET_TENANT_PARTNER_BY_ID: 'GET_TENANT_PARTNER_BY_ID',
    GET_TENANT_PARTNER_BY_OUR_AND_PARTNER_IDENTITY:
      'GET_TENANT_PARTNER_BY_OUR_AND_PARTNER_IDENTITY',
    NotFoundException: class NotFoundException extends Error {},
    InvalidParamException: class InvalidParamException extends Error {},
    UnsuccessfulRequestException: class UnsuccessfulRequestException extends Error {
      statusCode?: number;
      code?: string;
      constructor(
        message: string,
        _iRestResponse?: unknown,
        upstream?: { statusCode?: number; code?: string },
      ) {
        super(message);
        this.statusCode = upstream?.statusCode;
        this.code = upstream?.code;
      }
    },
    PENNYLANE_PARTNER_ALREADY_LINKED: 'ocpi_partner_already_linked',
    OcpiHeaders: class {},
    OcpiLogger: stubClass(),
    OcpiGraphqlClient: stubClass(),
    RoamingPartnerService: stubClass(),
    PennylaneService: stubClass(),
    TariffsService: stubClass(),
    LocationsPullService: stubClass(),
    LocationsService: stubClass(),
    SessionsService: stubClass(),
    CdrsService: stubClass(),
    DeleteLocationBodySchema: {},
    DeleteLocationBodySchemaName: 'DeleteLocationBodySchema',
  };
});

import { UnsuccessfulRequestException } from '@citrineos/ocpi-base';
import { AdminModuleApi } from '../module/AdminModuleApi.js';

type Outcome = 'created' | 'role_added' | 'unchanged';

const body = {
  ourCountryCode: 'FR',
  ourPartyId: 'ZTA',
  partnerCountryCode: 'FR',
  partnerPartyId: 'HUB',
  roamingPartnerCountryCode: 'DE',
  roamingPartnerPartyId: 'ABC',
  roamingPartnerName: 'ABC Mobility',
  roamingPartnerSignatureDate: '2026-01-15',
  roamingPartnerContractStartDate: '2026-02-01',
};

const billing = {
  paymentConditions: '30_days' as const,
  emails: ['compta@acme-transports.fr'],
  billingAddress: {
    address: '12 rue de la Gare',
    postalCode: '21190',
    city: 'Meursault',
    countryAlpha2: 'FR',
  },
  vatNumber: 'FR12345678901',
  regNo: '123456789',
  phone: '+33380000000',
  recipient: 'Service comptabilite',
  billingIban: 'FR7630006000011234567890189',
  notes: 'Created from Patterm',
  billingLanguage: 'fr_FR',
  reference: 'ACME-001',
  externalReference: 'patterm-company-1234',
};

const emspBody = { ...body, ...billing, contractNb: 'GIR-2026-001' };

const flushBackgroundWork = () =>
  new Promise((resolve) => setImmediate(resolve));

// The network pull awaits several calls per partner, one partner after another.
const flushNetworkPull = async () => {
  for (let i = 0; i < 20; i++) {
    await flushBackgroundWork();
  }
};

const {
  roamingPartnerCountryCode: _cc,
  roamingPartnerPartyId: _pid,
  ...hub
} = body;

const networkBody = {
  ...hub,
  roamingPartnerName: 'GreenFlux',
  operationOwner: 'GreenFlux Assets B.V.',
  operations: [
    {
      'Operation Emi3': 'FR*S13',
      'Operation Owner': 'GreenFlux Assets B.V.',
    },
    {
      'Operation Emi3': 'NL*EVN',
      'Operation Owner': 'GreenFlux Assets B.V.',
    },
    { 'Operation Emi3': 'FR*TCB', 'Operation Owner': 'Other CPO SAS' },
  ],
};

const networkEmspBody = {
  ...networkBody,
  ...billing,
  contractNb: 'GIR-2026-001',
};

const partnerBodyFor = (countryCode: string, partyId: string) => ({
  ...hub,
  roamingPartnerCountryCode: countryCode,
  roamingPartnerPartyId: partyId,
  roamingPartnerName: 'GreenFlux',
  roamingPartnerSignatureDate: '2026-01-15',
  roamingPartnerContractStartDate: '2026-02-01',
  roamingPartnerIsHdv: undefined,
});

const pullTargetFor = (countryCode: string, partyId: string) => ({
  ourCountryCode: 'FR',
  ourPartyId: 'ZTA',
  partnerCountryCode: 'FR',
  partnerPartyId: 'HUB',
  roamingPartnerCountryCode: countryCode,
  roamingPartnerPartyId: partyId,
});

describe('AdminModuleApi roaming partner routes', () => {
  let api: AdminModuleApi;
  let logger: { info: jest.Mock; error: jest.Mock; warn: jest.Mock };
  let upsertRoamingPartner: jest.Mock;
  let pullPartnerTariffs: jest.Mock;
  let pullPartnerLocations: jest.Mock;
  let createCompanyCustomer: jest.Mock;
  let graphqlRequest: jest.Mock;

  const givenOutcome = (outcome: Outcome) =>
    upsertRoamingPartner.mockResolvedValue({
      id: 1,
      tenantPartnerId: 2,
      outcome,
    });

  beforeEach(() => {
    logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    upsertRoamingPartner = jest.fn();
    pullPartnerTariffs = jest.fn().mockResolvedValue({ processed: 3 });
    pullPartnerLocations = jest.fn().mockResolvedValue({ processed: 5 });
    createCompanyCustomer = jest.fn().mockResolvedValue({
      customer: { id: 7, name: 'ABC Mobility' },
      created: true,
    });
    graphqlRequest = jest.fn();
    api = new AdminModuleApi(
      logger as any,
      { upsertRoamingPartner } as any,
      { pullPartnerTariffs } as any,
      { PullPartnerLocations: pullPartnerLocations } as any,
      {} as any,
      {} as any,
      { request: graphqlRequest } as any,
      {} as any, // locationsService
      { createCompanyCustomer } as any,
    );
  });

  describe('POST /create-roaming-partner-cpo', () => {
    it.each([
      ['created', 'roaming partner created'],
      ['role_added', 'role added to existing roaming partner'],
      ['unchanged', 'roaming partner already exists'],
    ] as const)('with outcome %s returns "%s"', async (outcome, status) => {
      givenOutcome(outcome);

      await expect(api.createRoamingPartnerCpo(body)).resolves.toEqual({
        status,
      });
      expect(upsertRoamingPartner).toHaveBeenCalledWith(body, 'CPO');
    });

    it('does not pull any partner data', async () => {
      givenOutcome('created');

      await api.createRoamingPartnerCpo(body);
      await flushBackgroundWork();

      expect(pullPartnerTariffs).not.toHaveBeenCalled();
      expect(pullPartnerLocations).not.toHaveBeenCalled();
    });

    it('rejects when the service rejects', async () => {
      upsertRoamingPartner.mockRejectedValue(new Error('conflict'));

      await expect(api.createRoamingPartnerCpo(body)).rejects.toThrow(
        'conflict',
      );
    });
  });

  describe('POST /create-roaming-partner-emsp', () => {
    it.each([
      ['created', 'roaming partner created'],
      ['role_added', 'role added to existing roaming partner'],
      ['unchanged', 'roaming partner already exists'],
    ] as const)('with outcome %s returns "%s"', async (outcome, status) => {
      givenOutcome(outcome);

      await expect(api.createRoamingPartnerEmsp(body)).resolves.toEqual({
        status,
      });
      expect(upsertRoamingPartner).toHaveBeenCalledWith(body, 'EMSP');
    });

    it('does not pull any partner data', async () => {
      givenOutcome('created');

      await api.createRoamingPartnerEmsp(body);
      await flushBackgroundWork();

      expect(pullPartnerTariffs).not.toHaveBeenCalled();
      expect(pullPartnerLocations).not.toHaveBeenCalled();
    });

    it('rejects when the service rejects', async () => {
      upsertRoamingPartner.mockRejectedValue(new Error('conflict'));

      await expect(api.createRoamingPartnerEmsp(body)).rejects.toThrow(
        'conflict',
      );
    });
  });

  describe('POST /onboard-roaming-partner-cpo', () => {
    it.each(['created', 'role_added'] as const)(
      'with outcome %s returns accepted and pulls tariffs then locations',
      async (outcome) => {
        givenOutcome(outcome);

        await expect(api.onboardRoamingPartnerCpo(body)).resolves.toEqual({
          status: 'accepted',
        });
        await flushBackgroundWork();

        expect(upsertRoamingPartner).toHaveBeenCalledWith(body, 'CPO');
        expect(pullPartnerTariffs).toHaveBeenCalledWith({
          ourCountryCode: 'FR',
          ourPartyId: 'ZTA',
          partnerCountryCode: 'FR',
          partnerPartyId: 'HUB',
          roamingPartnerCountryCode: 'DE',
          roamingPartnerPartyId: 'ABC',
          offset: 0,
          limit: 100,
        });
        expect(pullPartnerLocations).toHaveBeenCalledWith({
          ourCountryCode: 'FR',
          ourPartyId: 'ZTA',
          partnerCountryCode: 'FR',
          partnerPartyId: 'HUB',
          roamingPartnerCountryCode: 'DE',
          roamingPartnerPartyId: 'ABC',
          offset: 0,
          limit: 20,
        });
        expect(pullPartnerTariffs.mock.invocationCallOrder[0]).toBeLessThan(
          pullPartnerLocations.mock.invocationCallOrder[0],
        );
      },
    );

    it('with outcome unchanged returns "already onboarded" and does not pull', async () => {
      givenOutcome('unchanged');

      await expect(api.onboardRoamingPartnerCpo(body)).resolves.toEqual({
        status: 'already onboarded',
      });
      await flushBackgroundWork();

      expect(pullPartnerTariffs).not.toHaveBeenCalled();
      expect(pullPartnerLocations).not.toHaveBeenCalled();
    });

    it('rejects and does not pull when the service rejects', async () => {
      upsertRoamingPartner.mockRejectedValue(new Error('conflict'));

      await expect(api.onboardRoamingPartnerCpo(body)).rejects.toThrow(
        'conflict',
      );
      await flushBackgroundWork();

      expect(pullPartnerTariffs).not.toHaveBeenCalled();
      expect(pullPartnerLocations).not.toHaveBeenCalled();
    });

    it('still returns accepted and logs when the background pull fails', async () => {
      givenOutcome('created');
      pullPartnerTariffs.mockRejectedValue(new Error('hub down'));

      await expect(api.onboardRoamingPartnerCpo(body)).resolves.toEqual({
        status: 'accepted',
      });
      await flushBackgroundWork();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to pull partner data',
        expect.any(Error),
      );
      expect(pullPartnerLocations).not.toHaveBeenCalled();
    });
  });

  describe('POST /onboard-roaming-partner-emsp', () => {
    it('with outcome created registers the partner and creates the Pennylane customer with the snake_case TS API payload', async () => {
      givenOutcome('created');

      await expect(
        api.onboardRoamingPartnerEmsp(emspBody, 'Bearer caller.token'),
      ).resolves.toEqual({
        status: 'roaming partner created; pennylane customer created',
        pennylaneCustomerId: 7,
      });
      expect(upsertRoamingPartner).toHaveBeenCalledWith(emspBody, 'EMSP');
      expect(createCompanyCustomer).toHaveBeenCalledTimes(1);
      expect(createCompanyCustomer).toHaveBeenCalledWith(
        {
          name: 'ABC Mobility',
          payment_conditions: '30_days',
          emails: ['compta@acme-transports.fr'],
          billing_address: {
            address: '12 rue de la Gare',
            postal_code: '21190',
            city: 'Meursault',
            country_alpha2: 'FR',
          },
          vat_number: 'FR12345678901',
          reg_no: '123456789',
          phone: '+33380000000',
          recipient: 'Service comptabilite',
          billing_iban: 'FR7630006000011234567890189',
          notes: 'Created from Patterm',
          billing_language: 'fr_FR',
          reference: 'ACME-001',
          external_reference: 'patterm-company-1234',
          tenant_partner_id: 2,
          roaming_partner_id: 1,
          contract_nb: 'GIR-2026-001',
        },
        'Bearer caller.token',
      );
    });

    it.each([
      ['role_added', 'role added to existing roaming partner'],
      ['unchanged', 'roaming partner already exists'],
    ] as const)(
      'with outcome %s still creates the Pennylane customer',
      async (outcome, upsertStatus) => {
        givenOutcome(outcome);

        await expect(
          api.onboardRoamingPartnerEmsp(emspBody, 'Bearer caller.token'),
        ).resolves.toEqual({
          status: `${upsertStatus}; pennylane customer created`,
          pennylaneCustomerId: 7,
        });
        expect(upsertRoamingPartner).toHaveBeenCalledWith(emspBody, 'EMSP');
        expect(createCompanyCustomer).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'ABC Mobility',
            tenant_partner_id: 2,
            roaming_partner_id: 1,
          }),
          'Bearer caller.token',
        );
      },
    );

    it('reports a linked existing Pennylane customer instead of a created one', async () => {
      givenOutcome('created');
      createCompanyCustomer.mockResolvedValue({
        customer: { id: 9, name: 'ABC Mobility SAS' },
        created: false,
      });

      await expect(api.onboardRoamingPartnerEmsp(emspBody)).resolves.toEqual({
        status: 'roaming partner created; existing pennylane customer linked',
        pennylaneCustomerId: 9,
      });
    });

    it.each([
      ['created', 'roaming partner created'],
      ['role_added', 'role added to existing roaming partner'],
      ['unchanged', 'roaming partner already exists'],
    ] as const)(
      'with outcome %s treats the TS API "partner already linked" 409 as success',
      async (outcome, upsertStatus) => {
        givenOutcome(outcome);
        createCompanyCustomer.mockRejectedValue(
          new UnsuccessfulRequestException('already linked', undefined, {
            statusCode: 409,
            code: 'ocpi_partner_already_linked',
          }),
        );

        await expect(api.onboardRoamingPartnerEmsp(emspBody)).resolves.toEqual({
          status: `${upsertStatus}; pennylane customer already linked`,
        });
        expect(logger.error).not.toHaveBeenCalled();
      },
    );

    it('rejects on a TS API 409 with another code', async () => {
      givenOutcome('unchanged');
      createCompanyCustomer.mockRejectedValue(
        new UnsuccessfulRequestException('customer exists', undefined, {
          statusCode: 409,
          code: 'customer_already_exists',
        }),
      );

      const error = await api
        .onboardRoamingPartnerEmsp(emspBody)
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnsuccessfulRequestException);
      expect(error.message).toBe(
        'roaming partner already exists; pennylane customer creation failed: customer exists',
      );
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('customer_already_exists');
    });

    it('keeps the partner and rejects with the TS API status when the TS API fails', async () => {
      givenOutcome('created');
      createCompanyCustomer.mockRejectedValue(
        new UnsuccessfulRequestException(
          'TS API company customer request failed with status 502: Pennylane is unreachable',
          undefined,
          { statusCode: 502 },
        ),
      );

      const error = await api
        .onboardRoamingPartnerEmsp(emspBody)
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnsuccessfulRequestException);
      expect(error.message).toBe(
        'roaming partner created; pennylane customer creation failed: TS API company customer request failed with status 502: Pennylane is unreachable',
      );
      expect(error.statusCode).toBe(502);
      expect(upsertRoamingPartner).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create Pennylane customer',
        expect.any(Error),
      );
    });

    it('rejects with UnsuccessfulRequestException when the TS API is not configured', async () => {
      givenOutcome('created');
      createCompanyCustomer.mockRejectedValue(
        new Error('TS API is not configured (set CITRINEOS_OCPI_TSAPI_URL)'),
      );

      const error = await api
        .onboardRoamingPartnerEmsp(emspBody)
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnsuccessfulRequestException);
      expect(error.message).toBe(
        'roaming partner created; pennylane customer creation failed: TS API is not configured (set CITRINEOS_OCPI_TSAPI_URL)',
      );
      expect(error.statusCode).toBeUndefined();
    });

    it('does not run the CPO tariffs/locations pull', async () => {
      givenOutcome('created');

      await api.onboardRoamingPartnerEmsp(emspBody);
      await flushBackgroundWork();

      expect(pullPartnerTariffs).not.toHaveBeenCalled();
      expect(pullPartnerLocations).not.toHaveBeenCalled();
    });

    it('rejects without calling the TS API when the service rejects', async () => {
      upsertRoamingPartner.mockRejectedValue(new Error('conflict'));

      await expect(api.onboardRoamingPartnerEmsp(emspBody)).rejects.toThrow(
        'conflict',
      );
      expect(createCompanyCustomer).not.toHaveBeenCalled();
    });
  });

  describe('POST /onboard-tenant-partner-emsp', () => {
    const tenantBody = {
      ourCountryCode: 'FR',
      ourPartyId: 'ZTA',
      partnerCountryCode: 'FR',
      partnerPartyId: 'MSP',
      tenantPartnerName: 'MSP Direct',
      ...billing,
    };

    const givenTenantPartner = (rows: { id: number }[]) =>
      graphqlRequest.mockResolvedValue({ TenantPartners: rows });

    it('looks up the tenant partner by OCPI identity', async () => {
      givenTenantPartner([{ id: 5 }]);
      createCompanyCustomer.mockResolvedValue({
        customer: { id: 42, name: 'MSP Direct' },
        created: true,
      });

      await api.onboardTenantPartnerEmsp(tenantBody);

      expect(graphqlRequest).toHaveBeenCalledWith(
        'GET_TENANT_PARTNER_BY_OUR_AND_PARTNER_IDENTITY',
        {
          ourCountryCode: 'FR',
          ourPartyId: 'ZTA',
          partnerCountryCode: 'FR',
          partnerPartyId: 'MSP',
        },
      );
    });

    it('creates the Pennylane customer linked to the tenant partner only, forwarding the token', async () => {
      givenTenantPartner([{ id: 5 }]);
      createCompanyCustomer.mockResolvedValue({
        customer: { id: 42, name: 'MSP Direct' },
        created: true,
      });

      await expect(
        api.onboardTenantPartnerEmsp(tenantBody, 'Bearer caller.token'),
      ).resolves.toEqual({
        status: 'pennylane customer created',
        pennylaneCustomerId: 42,
      });

      const [payload, authorization] = createCompanyCustomer.mock.calls[0];
      expect(payload).toEqual(
        expect.objectContaining({
          name: 'MSP Direct',
          payment_conditions: '30_days',
          vat_number: 'FR12345678901',
          tenant_partner_id: 5,
        }),
      );
      expect(payload).not.toHaveProperty('roaming_partner_id');
      expect(authorization).toBe('Bearer caller.token');
    });

    it('reports a linked existing Pennylane customer instead of a created one', async () => {
      givenTenantPartner([{ id: 5 }]);
      createCompanyCustomer.mockResolvedValue({
        customer: { id: 43, name: 'MSP Direct SAS' },
        created: false,
      });

      await expect(api.onboardTenantPartnerEmsp(tenantBody)).resolves.toEqual({
        status: 'existing pennylane customer linked',
        pennylaneCustomerId: 43,
      });
    });

    it('rejects with NotFoundException and does not call the TS API when the tenant partner does not exist', async () => {
      givenTenantPartner([]);

      await expect(api.onboardTenantPartnerEmsp(tenantBody)).rejects.toThrow(
        /Tenant partner FR-MSP not found for FR-ZTA/,
      );
      expect(createCompanyCustomer).not.toHaveBeenCalled();
    });

    it('returns the TS API failure to the caller', async () => {
      givenTenantPartner([{ id: 5 }]);
      createCompanyCustomer.mockRejectedValue(new Error('ts api 409'));

      await expect(api.onboardTenantPartnerEmsp(tenantBody)).rejects.toThrow(
        'ts api 409',
      );
    });

    it('never creates or updates a roaming partner, nor pulls partner data', async () => {
      givenTenantPartner([{ id: 5 }]);
      createCompanyCustomer.mockResolvedValue({
        customer: { id: 42, name: 'MSP Direct' },
        created: true,
      });

      await api.onboardTenantPartnerEmsp(tenantBody);
      await flushBackgroundWork();

      expect(upsertRoamingPartner).not.toHaveBeenCalled();
      expect(pullPartnerTariffs).not.toHaveBeenCalled();
      expect(pullPartnerLocations).not.toHaveBeenCalled();
    });
  });

  describe('POST /onboard-roaming-network-cpo', () => {
    const givenHub = () =>
      graphqlRequest.mockResolvedValue({ TenantPartners: [{ id: 2 }] });

    const givenOutcomes = (...outcomes: (Outcome | Error)[]) =>
      outcomes.forEach((outcome, index) =>
        outcome instanceof Error
          ? upsertRoamingPartner.mockRejectedValueOnce(outcome)
          : upsertRoamingPartner.mockResolvedValueOnce({
              id: 10 + index,
              tenantPartnerId: 2,
              outcome,
            }),
      );

    it('registers each operation of the owner with the shared contract data and reports the others as skipped', async () => {
      givenHub();
      givenOutcomes('created', 'unchanged');

      await expect(api.onboardRoamingNetworkCpo(networkBody)).resolves.toEqual({
        status: '2/2 operations registered; 1 queued for pull',
        failed: 0,
        pullQueued: 1,
        operations: [
          { operation: 'FR*S13', status: 'roaming partner created' },
          { operation: 'NL*EVN', status: 'roaming partner already exists' },
        ],
        skipped: [{ operation: 'FR*TCB', reason: 'owned by Other CPO SAS' }],
      });
      expect(upsertRoamingPartner.mock.calls).toEqual([
        [partnerBodyFor('FR', 'S13'), 'CPO'],
        [partnerBodyFor('NL', 'EVN'), 'CPO'],
      ]);
      await flushNetworkPull();
    });

    it('pulls tariffs then locations one partner after another, skipping unchanged partners', async () => {
      givenHub();
      givenOutcomes('created', 'unchanged');
      const body = {
        ...networkBody,
        operations: [
          ...networkBody.operations,
          {
            'Operation Emi3': 'BE*GFX',
            'Operation Owner': 'GreenFlux Assets B.V.',
          },
        ],
      };
      upsertRoamingPartner.mockResolvedValueOnce({
        id: 12,
        tenantPartnerId: 2,
        outcome: 'role_added',
      });

      await api.onboardRoamingNetworkCpo(body);
      await flushNetworkPull();

      expect(pullPartnerTariffs.mock.calls).toEqual([
        [{ ...pullTargetFor('FR', 'S13'), offset: 0, limit: 100 }],
        [{ ...pullTargetFor('BE', 'GFX'), offset: 0, limit: 100 }],
      ]);
      expect(pullPartnerLocations.mock.calls).toEqual([
        [{ ...pullTargetFor('FR', 'S13'), offset: 0, limit: 20 }],
        [{ ...pullTargetFor('BE', 'GFX'), offset: 0, limit: 20 }],
      ]);
      const order = [
        pullPartnerTariffs.mock.invocationCallOrder[0],
        pullPartnerLocations.mock.invocationCallOrder[0],
        pullPartnerTariffs.mock.invocationCallOrder[1],
        pullPartnerLocations.mock.invocationCallOrder[1],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('also pulls unchanged partners with forcePull', async () => {
      givenHub();
      givenOutcomes('unchanged', 'unchanged');

      await expect(
        api.onboardRoamingNetworkCpo({ ...networkBody, forcePull: true }),
      ).resolves.toMatchObject({ pullQueued: 2 });
      await flushNetworkPull();

      expect(pullPartnerTariffs).toHaveBeenCalledTimes(2);
    });

    it('reports a failed upsert and goes on with the next operations, without pulling it', async () => {
      givenHub();
      givenOutcomes(new Error('different name'), 'created');

      const result = await api.onboardRoamingNetworkCpo(networkBody);
      await flushNetworkPull();

      expect(result.status).toBe(
        '1/2 operations registered; 1 queued for pull',
      );
      expect(result.failed).toBe(1);
      expect(result.operations[0]).toEqual({
        operation: 'FR*S13',
        status: 'failed',
        error: 'different name',
      });
      expect(pullPartnerTariffs.mock.calls).toEqual([
        [{ ...pullTargetFor('NL', 'EVN'), offset: 0, limit: 100 }],
      ]);
    });

    it('goes on with the next partner when a pull fails, and logs it', async () => {
      givenHub();
      givenOutcomes('created', 'created');
      pullPartnerTariffs.mockRejectedValueOnce(new Error('hub down'));

      await api.onboardRoamingNetworkCpo(networkBody);
      await flushNetworkPull();

      expect(logger.error).toHaveBeenCalledWith(
        'Network pull failed for FR*S13',
        expect.any(Error),
      );
      expect(pullPartnerLocations.mock.calls).toEqual([
        [{ ...pullTargetFor('NL', 'EVN'), offset: 0, limit: 20 }],
      ]);
      expect(logger.info).toHaveBeenCalledWith('Network pull completed', {
        network: networkBody.roamingPartnerName,
        success: false,
        total: 2,
        failed: 1,
      });
    });

    it('rejects a second network while a pull is running, and accepts one once it has completed', async () => {
      givenHub();
      givenOutcomes('created', 'created');
      let finishPull: () => void = () => undefined;
      pullPartnerTariffs.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishPull = () => resolve({ processed: 0 });
          }),
      );

      await api.onboardRoamingNetworkCpo(networkBody);
      await expect(api.onboardRoamingNetworkCpo(networkBody)).rejects.toThrow(
        'A network pull is already running',
      );

      finishPull();
      await flushNetworkPull();
      givenOutcomes('unchanged', 'unchanged');
      await expect(
        api.onboardRoamingNetworkCpo(networkBody),
      ).resolves.toMatchObject({ pullQueued: 0 });
    });

    it('does not hold the lock when there is nothing to pull', async () => {
      givenHub();
      givenOutcomes('unchanged', 'unchanged', 'unchanged', 'unchanged');

      await api.onboardRoamingNetworkCpo(networkBody);
      await expect(
        api.onboardRoamingNetworkCpo(networkBody),
      ).resolves.toMatchObject({ pullQueued: 0 });
      expect(pullPartnerTariffs).not.toHaveBeenCalled();
    });

    it('rejects with NotFoundException before any write when the hub does not exist, and releases the lock', async () => {
      graphqlRequest.mockResolvedValue({ TenantPartners: [] });

      await expect(api.onboardRoamingNetworkCpo(networkBody)).rejects.toThrow(
        'Tenant partner FR-HUB not found for FR-ZTA',
      );
      expect(upsertRoamingPartner).not.toHaveBeenCalled();

      givenHub();
      givenOutcomes('unchanged', 'unchanged');
      await expect(
        api.onboardRoamingNetworkCpo(networkBody),
      ).resolves.toBeDefined();
    });

    it('never calls the TS API', async () => {
      givenHub();
      givenOutcomes('created', 'created');

      await api.onboardRoamingNetworkCpo(networkBody);
      await flushNetworkPull();

      expect(createCompanyCustomer).not.toHaveBeenCalled();
    });

    it('counts every failed operation, still answering 200', async () => {
      givenHub();
      givenOutcomes(new Error('conflict'), new Error('conflict'));

      await expect(
        api.onboardRoamingNetworkCpo(networkBody),
      ).resolves.toMatchObject({
        status: '0/2 operations registered; 0 queued for pull',
        failed: 2,
        pullQueued: 0,
      });
    });

    it('logs an unexpected rejection of the background pull instead of leaving it unhandled, and releases the lock', async () => {
      givenHub();
      givenOutcomes('created', 'created');
      jest
        .spyOn(api as any, 'pullNetwork')
        .mockRejectedValueOnce(new Error('boom'));

      await api.onboardRoamingNetworkCpo(networkBody);
      await flushNetworkPull();

      expect(logger.error).toHaveBeenCalledWith(
        'Network pull crashed',
        expect.any(Error),
      );

      givenOutcomes('unchanged', 'unchanged');
      await expect(
        api.onboardRoamingNetworkCpo(networkBody),
      ).resolves.toMatchObject({ pullQueued: 0 });
    });
  });

  describe('POST /onboard-roaming-network-emsp', () => {
    beforeEach(() => {
      graphqlRequest.mockResolvedValue({ TenantPartners: [{ id: 2 }] });
      upsertRoamingPartner
        .mockResolvedValueOnce({
          id: 10,
          tenantPartnerId: 2,
          outcome: 'created',
        })
        .mockResolvedValueOnce({
          id: 11,
          tenantPartnerId: 2,
          outcome: 'created',
        });
    });

    it('registers each operation as EMSP and links it to the same Pennylane customer, in order', async () => {
      createCompanyCustomer
        .mockResolvedValueOnce({
          customer: { id: 7, name: 'GreenFlux' },
          created: true,
        })
        .mockResolvedValueOnce({
          customer: { id: 7, name: 'GreenFlux' },
          created: false,
        });

      await expect(
        api.onboardRoamingNetworkEmsp(networkEmspBody, 'Bearer caller.token'),
      ).resolves.toEqual({
        status: '2/2 operations onboarded',
        failed: 0,
        pennylaneCustomerIds: [7],
        operations: [
          {
            operation: 'FR*S13',
            status: 'roaming partner created; pennylane customer created',
            pennylaneCustomerId: 7,
          },
          {
            operation: 'NL*EVN',
            status:
              'roaming partner created; existing pennylane customer linked',
            pennylaneCustomerId: 7,
          },
        ],
        skipped: [{ operation: 'FR*TCB', reason: 'owned by Other CPO SAS' }],
      });

      expect(upsertRoamingPartner.mock.calls).toEqual([
        [partnerBodyFor('FR', 'S13'), 'EMSP'],
        [partnerBodyFor('NL', 'EVN'), 'EMSP'],
      ]);
      expect(createCompanyCustomer).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          name: 'GreenFlux',
          vat_number: 'FR12345678901',
          tenant_partner_id: 2,
          roaming_partner_id: 10,
          contract_nb: 'GIR-2026-001',
        }),
        'Bearer caller.token',
      );
      expect(createCompanyCustomer).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ name: 'GreenFlux', roaming_partner_id: 11 }),
        'Bearer caller.token',
      );
      expect(upsertRoamingPartner.mock.invocationCallOrder[1]).toBeGreaterThan(
        createCompanyCustomer.mock.invocationCallOrder[0],
      );
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Network EMSP onboarding started',
        { network: 'GreenFlux', total: 2, skipped: 1 },
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Network EMSP onboarding completed',
        {
          network: 'GreenFlux',
          success: true,
          total: 2,
          failed: 0,
          skipped: 1,
          pennylaneCustomerIds: [7],
        },
      );
    });

    it('reports a failed operation and goes on with the next ones', async () => {
      createCompanyCustomer
        .mockRejectedValueOnce(new Error('invalid VAT'))
        .mockRejectedValueOnce(
          new UnsuccessfulRequestException('conflict', undefined, {
            statusCode: 409,
            code: 'ocpi_partner_already_linked',
          }),
        );

      const result = await api.onboardRoamingNetworkEmsp(networkEmspBody);

      expect(result.status).toBe('1/2 operations onboarded');
      expect(result.failed).toBe(1);
      expect(result.pennylaneCustomerIds).toEqual([]);
      expect(result.operations).toEqual([
        {
          operation: 'FR*S13',
          status: 'failed',
          error:
            'roaming partner created; pennylane customer creation failed: invalid VAT',
        },
        {
          operation: 'NL*EVN',
          status: 'roaming partner created; pennylane customer already linked',
        },
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        'Network EMSP onboarding completed',
        expect.objectContaining({ success: false, total: 2, failed: 1 }),
      );
    });

    it('warns when the operations end up on several Pennylane customers', async () => {
      createCompanyCustomer
        .mockResolvedValueOnce({
          customer: { id: 7, name: 'GreenFlux' },
          created: true,
        })
        .mockResolvedValueOnce({
          customer: { id: 8, name: 'GreenFlux' },
          created: true,
        });

      const result = await api.onboardRoamingNetworkEmsp(networkEmspBody);

      expect(result.pennylaneCustomerIds).toEqual([7, 8]);
      expect(logger.warn).toHaveBeenCalledWith(
        'Network GreenFlux is linked to 2 Pennylane customers',
        [7, 8],
      );
    });

    it('rejects with NotFoundException before any write when the hub does not exist, and releases the lock', async () => {
      graphqlRequest.mockResolvedValue({ TenantPartners: [] });

      await expect(
        api.onboardRoamingNetworkEmsp(networkEmspBody),
      ).rejects.toThrow('Tenant partner FR-HUB not found');
      expect(upsertRoamingPartner).not.toHaveBeenCalled();
      expect(createCompanyCustomer).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'Network EMSP onboarding completed',
        {
          network: 'GreenFlux',
          success: false,
          total: 2,
          error: expect.stringContaining('Tenant partner FR-HUB not found'),
        },
      );

      graphqlRequest.mockResolvedValue({ TenantPartners: [{ id: 2 }] });
      await expect(
        api.onboardRoamingNetworkEmsp(networkEmspBody),
      ).resolves.toMatchObject({ status: '2/2 operations onboarded' });
    });

    it('rejects a second network while one is running, and accepts one once it has completed', async () => {
      let finishFirst: () => void = () => undefined;
      createCompanyCustomer.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = () =>
              resolve({
                customer: { id: 7, name: 'GreenFlux' },
                created: true,
              });
          }),
      );

      const first = api.onboardRoamingNetworkEmsp(networkEmspBody);
      await flushBackgroundWork();
      await expect(
        api.onboardRoamingNetworkEmsp(networkEmspBody),
      ).rejects.toThrow('A network EMSP onboarding is already running');

      finishFirst();
      await expect(first).resolves.toMatchObject({ failed: 0 });

      upsertRoamingPartner.mockResolvedValue({
        id: 10,
        tenantPartnerId: 2,
        outcome: 'unchanged',
      });
      await expect(
        api.onboardRoamingNetworkEmsp(networkEmspBody),
      ).resolves.toMatchObject({ status: '2/2 operations onboarded' });
    });

    it('releases the lock when the run fails', async () => {
      graphqlRequest.mockRejectedValueOnce(new Error('hasura down'));

      await expect(
        api.onboardRoamingNetworkEmsp(networkEmspBody),
      ).rejects.toThrow('hasura down');
      await expect(
        api.onboardRoamingNetworkEmsp(networkEmspBody),
      ).resolves.toBeDefined();
    });

    it('does not pull any partner data', async () => {
      await api.onboardRoamingNetworkEmsp(networkEmspBody);
      await flushNetworkPull();

      expect(pullPartnerTariffs).not.toHaveBeenCalled();
      expect(pullPartnerLocations).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['create-roaming-partner-cpo', 'createRoamingPartnerCpo'],
    ['create-roaming-partner-emsp', 'createRoamingPartnerEmsp'],
    ['onboard-roaming-partner-cpo', 'onboardRoamingPartnerCpo'],
  ] as const)('%s never calls the TS API', async (_route, method) => {
    givenOutcome('created');

    await api[method](body);
    await flushBackgroundWork();

    expect(createCompanyCustomer).not.toHaveBeenCalled();
  });
});
