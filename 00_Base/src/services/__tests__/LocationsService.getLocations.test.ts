// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// The service is exercised with stubbed collaborators: no Hasura, no real mapper.
jest.mock('../../graphql/index.js', () => ({
  GET_OUR_LOCATIONS_QUERY: 'GET_OUR_LOCATIONS_QUERY',
  OcpiGraphqlClient: class {},
}));
jest.mock('../../trigger/LocationsClientApi.js', () => ({
  LocationsClientApi: class {},
}));
jest.mock('../LocationReceiverService.js', () => ({
  LocationReceiverService: class {},
}));
jest.mock('../../index.js', () => ({
  ModuleId: {},
  shouldBroadcastToPartner: jest.fn(),
}));
jest.mock('../../mapper/index.js', () => ({
  LocationMapper: { fromGraphql: jest.fn() },
  EvseMapper: {},
  ConnectorMapper: {},
}));
jest.mock('@zetra/citrineos-base', () => ({ HttpMethod: { Get: 'GET' } }));

import { LocationMapper } from '../../mapper/index.js';
import { LocationsService } from '../LocationsService';

describe('LocationsService.getLocations', () => {
  const logger = { info: jest.fn(), error: jest.fn() };
  const graphql = {
    request: jest.fn().mockResolvedValue({
      Locations: [{ id: 1 }, { id: 7 }, { id: 9 }],
      Locations_aggregate: { aggregate: { count: 3 } },
    }),
  };
  const service = new LocationsService(
    logger as any,
    graphql as any,
    {} as any,
    {} as any,
  );

  it('leaves out and logs a location that cannot be mapped, and sends the rest of the page', async () => {
    (LocationMapper.fromGraphql as jest.Mock).mockImplementation(
      (location: { id: number }) => {
        if (location.id === 7) {
          throw new Error('Tariff 42 has no ocpiTariffId');
        }
        return { id: String(location.id) };
      },
    );

    const response = await service.getLocations({
      toCountryCode: 'FR',
      toPartyId: 'ZET',
    } as any);

    expect(response.data).toEqual([{ id: '1' }, { id: '9' }]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /Location 7 not sent.*Tariff 42 has no ocpiTariffId/,
      ),
    );
  });
});
