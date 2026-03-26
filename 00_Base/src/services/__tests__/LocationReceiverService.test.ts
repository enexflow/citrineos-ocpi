// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { LocationReceiverService } from '../LocationReceiverService';
import { OcpiGraphqlClient } from '../../graphql/OcpiGraphqlClient';
import { OcpiResponseStatusCode } from '../../model/OcpiResponse';

// Mock the graphql client class
jest.mock('../../graphql/OcpiGraphqlClient');

// (Optional) mock mappers if you want to avoid deep DTO building
jest.mock('../../mapper/index', () => ({
  LocationMapper: { fromGraphqlReceiver: jest.fn() },
  EvseMapper: { fromGraphqlReceiver: jest.fn() },
  ConnectorMapper: { fromGraphqlReceiver: jest.fn() },
}));

import {
  GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY,
  GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY,
  GET_CONNECTOR_BY_OCPI_ID_AND_EVSE_ID,
} from '../../graphql/index';

import { LocationMapper, EvseMapper, ConnectorMapper } from '../../mapper/index';

describe('LocationReceiverService', () => {
  let service: LocationReceiverService;
  let mockGraphqlClient: jest.Mocked<OcpiGraphqlClient>;
  const logger = { debug: jest.fn(), info: jest.fn(), error: jest.fn() } as any;

  const ctx = { state: { tenantPartner: { id: 42 } } };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGraphqlClient = { request: jest.fn() } as any;
    service = new LocationReceiverService(logger, mockGraphqlClient);
  });

  describe('getLocationByCountryPartyAndId', () => {
    it('calls GraphQL with partnerId from ctx and returns success', async () => {
      (LocationMapper.fromGraphqlReceiver as jest.Mock).mockReturnValue({ id: 'LOC-1' });

      mockGraphqlClient.request.mockResolvedValue({
        Locations: [{ id: 1 }], // minimal; mapper is mocked anyway
      });

      const res = await service.getLocationByCountryPartyAndId('FR', 'TMS', 'LOC-1', ctx);

      expect(mockGraphqlClient.request).toHaveBeenCalledWith(
        GET_LOCATION_BY_OCPI_ID_AND_PARTNER_ID_QUERY,
        { id: 'LOC-1', partnerId: 42 },
      );
      expect(res.status_code).toBe(OcpiResponseStatusCode.GenericSuccessCode);
      expect(res.data).toEqual({ id: 'LOC-1' });
    });

    it('returns error when ctx.state.tenantPartner missing', async () => {
      const res = await service.getLocationByCountryPartyAndId('FR', 'TMS', 'LOC-1', { state: {} });

      expect(res.status_code).toBe(OcpiResponseStatusCode.ClientGenericError);
    });
  });

  describe('getEvseByCountryPartyAndId', () => {
    it('calls GraphQL with locationId/evseUid/partnerId and returns success', async () => {
      (EvseMapper.fromGraphqlReceiver as jest.Mock).mockReturnValue({ uid: 'EVSE-1' });

      mockGraphqlClient.request.mockResolvedValue({
        Evses: [{ ChargingStation: { id: 'CS-1' }, id: 10 }],
      });

      const res = await service.getEvseByCountryPartyAndId('FR', 'TMS', 'LOC-1', 'EVSE-1', ctx);

      expect(mockGraphqlClient.request).toHaveBeenCalledWith(
        GET_EVSE_BY_OCPI_ID_AND_PARTNER_ID_QUERY,
        { locationId: 'LOC-1', partnerId: 42, evseUid: 'EVSE-1' },
      );
      expect(res.status_code).toBe(OcpiResponseStatusCode.GenericSuccessCode);
      expect(res.data).toEqual({ uid: 'EVSE-1' });
    });
  });

  describe('getConnectorByCountryPartyAndId', () => {
    it('calls GraphQL with locationId/evseUid/connectorId/partnerId and returns success', async () => {
      (ConnectorMapper.fromGraphqlReceiver as jest.Mock).mockReturnValue({ id: 'C-1' });

      mockGraphqlClient.request.mockResolvedValue({
        Connectors: [{ id: 99 }],
      });

      const res = await service.getConnectorByCountryPartyAndId(
        'FR',
        'TMS',
        'LOC-1',
        'EVSE-1',
        'C-1',
        ctx,
      );

      expect(mockGraphqlClient.request).toHaveBeenCalledWith(
        GET_CONNECTOR_BY_OCPI_ID_AND_EVSE_ID,
        { locationId: 'LOC-1', partnerId: 42, evseUid: 'EVSE-1', connectorId: 'C-1' },
      );
      expect(res.status_code).toBe(OcpiResponseStatusCode.GenericSuccessCode);
      expect(res.data).toEqual({ id: 'C-1' });
    });
  });
});