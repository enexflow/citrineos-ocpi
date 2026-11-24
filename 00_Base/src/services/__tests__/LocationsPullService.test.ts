// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// The service is exercised with stubbed collaborators: no hub, no Hasura.
jest.mock('../../graphql/index.js', () => ({
  GET_KNOWN_LOCATION_IDS_QUERY: 'GET_KNOWN_LOCATION_IDS_QUERY',
  GET_KNOWN_LOCATION_IDS_QUERY_WITH_ROAMING_PARTNER_ID:
    'GET_KNOWN_LOCATION_IDS_QUERY_WITH_ROAMING_PARTNER_ID',
  GET_TENANT_PARTNER_BY_OUR_AND_PARTNER_IDENTITY:
    'GET_TENANT_PARTNER_BY_OUR_AND_PARTNER_IDENTITY',
  MARK_LOCATION_REMOVED_QUERY: 'MARK_LOCATION_REMOVED_QUERY',
  GET_LOCATION_BY_OCPI_ID_PARTNER_AND_ROAMING_PARTNER_ID_QUERY:
    'GET_LOCATION_BY_OCPI_ID_PARTNER_AND_ROAMING_PARTNER_ID_QUERY',
  GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY:
    'GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY',
  MARK_EVSE_REMOVED_QUERY: 'MARK_EVSE_REMOVED_QUERY',
  MARK_CONNECTOR_DELETED_QUERY: 'MARK_CONNECTOR_DELETED_QUERY',
  OcpiGraphqlClient: class {},
}));
jest.mock('../../trigger/LocationsClientApi.js', () => ({
  LocationsClientApi: class {},
}));
jest.mock('../LocationReceiverService.js', () => ({
  LocationReceiverService: class {},
}));
jest.mock('@zetra/citrineos-base', () => ({ HttpMethod: { Get: 'GET' } }));
jest.mock('../../util/helpers.js', () => ({
  getRoamingPartner: (
    partner: { roamingPartners?: { countryCode: string; partyId: string }[] },
    countryCode: string,
    partyId: string,
  ) =>
    partner.roamingPartners?.find(
      (rp) => rp.countryCode === countryCode && rp.partyId === partyId,
    ) ?? null,
}));

import { LocationsPullService } from '../LocationsPullService';

const hub = {
  id: 2,
  tenantId: 1,
  countryCode: 'FR',
  partyId: '107',
  partnerProfileOCPI: {
    endpoints: [
      { identifier: 'locations_SENDER', url: 'https://hub.example/locations' },
    ],
  },
  roamingPartners: [{ id: 10, countryCode: 'FR', partyId: 'S13' }],
};

const pullBody = {
  ourCountryCode: 'FR',
  ourPartyId: 'ZTA',
  partnerCountryCode: 'FR',
  partnerPartyId: '107',
  roamingPartnerCountryCode: 'FR',
  roamingPartnerPartyId: 'S13',
  offset: 0,
  limit: 20,
};

const location = (id: string) => ({
  country_code: 'FR',
  party_id: 'S13',
  id,
  evses: [],
});

describe('LocationsPullService.PullPartnerLocations', () => {
  let logger: Record<string, jest.Mock>;
  let graphqlRequest: jest.Mock;
  let hubRequest: jest.Mock;
  let service: LocationsPullService;

  // Known locations of FR*S13 in the database.
  const known = [
    { id: 100, ocpiId: 'LOC-1' },
    { id: 101, ocpiId: 'LOC-2' },
  ];

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    graphqlRequest = jest.fn(async (query: string) => {
      switch (query) {
        case 'GET_TENANT_PARTNER_BY_OUR_AND_PARTNER_IDENTITY':
          return { TenantPartners: [hub] };
        case 'GET_KNOWN_LOCATION_IDS_QUERY_WITH_ROAMING_PARTNER_ID':
          return { Locations: known };
        case 'MARK_LOCATION_REMOVED_QUERY':
          return {};
        default:
          throw new Error(`unexpected query ${query}`);
      }
    });
    hubRequest = jest.fn();
    service = new LocationsPullService(
      logger as any,
      { request: graphqlRequest } as any,
      { request: hubRequest } as any,
      {
        upsertLocationForPartner: jest
          .fn()
          .mockResolvedValue({ locationId: 1 }),
      } as any,
    );
    jest.spyOn(service, 'reconcileEvsesForLocation').mockResolvedValue();
  });

  const markedRemovedIds = () =>
    graphqlRequest.mock.calls
      .filter(([query]) => query === 'MARK_LOCATION_REMOVED_QUERY')
      .map(([, variables]) => variables.locationId);

  it('marks the known locations missing from a full pull as removed', async () => {
    hubRequest.mockResolvedValue({ data: [location('LOC-1')] });

    const summary = await service.PullPartnerLocations(pullBody);

    expect(markedRemovedIds()).toEqual([101]);
    expect(summary.LocationsMarkedRemoved).toBe(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not mark any location removed when a full pull returns no location', async () => {
    hubRequest.mockResolvedValue({ data: [] });

    const summary = await service.PullPartnerLocations(pullBody);

    expect(markedRemovedIds()).toEqual([]);
    expect(summary.LocationsMarkedRemoved).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'PullPartnerLocations: full pull returned no location; known locations are not marked removed',
      expect.objectContaining({
        roamingPartnerCountryCode: 'FR',
        roamingPartnerPartyId: 'S13',
      }),
    );
  });

  it('does not mark any location removed when every returned item is invalid', async () => {
    hubRequest.mockResolvedValue({ data: [null, { name: 'no id' }] });

    const summary = await service.PullPartnerLocations(pullBody);

    expect(markedRemovedIds()).toEqual([]);
    expect(summary.skippedInvalid).toBe(2);
  });

  it('never marks locations removed in delta mode', async () => {
    hubRequest.mockResolvedValue({ data: [] });

    await service.PullPartnerLocations({
      ...pullBody,
      date_from: '2026-11-01T00:00:00Z',
    });

    expect(markedRemovedIds()).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
