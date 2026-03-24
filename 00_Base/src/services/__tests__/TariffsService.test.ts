// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

jest.mock('../../mapper/index', () => ({
  ...jest.requireActual('../../mapper/TariffMapper'),
  TariffMapper: jest.requireActual('../../mapper/TariffMapper').TariffMapper,
}));

import { TariffsService } from '../TariffsService';
import { OcpiGraphqlClient } from '../../graphql/OcpiGraphqlClient';
import { OcpiHeaders } from '../../model/OcpiHeaders';
import { PaginatedParams } from '../../controllers/param/PaginatedParams';
import { TariffDimensionType } from '../../model/TariffDimensionType';
import {
  GET_TARIFF_BY_KEY_QUERY,
  GET_TARIFF_BY_OCPI_ID_QUERY,
  GET_TARIFF_BY_PARTNER_QUERY,
  GET_TARIFFS_QUERY,
  CREATE_OR_UPDATE_TARIFF_MUTATION,
  DELETE_TARIFF_MUTATION,
} from '../../graphql/queries/tariff.queries';
import { GET_TENANT_PARTNER_ID_BY_COUNTRY_PARTY } from '../../graphql/queries/tenantPartner.queries';

jest.mock('../../graphql/OcpiGraphqlClient');

const mockCoreTariff = {
  id: 1,
  currency: 'EUR',
  pricePerKwh: 0.25,
  pricePerMin: null,
  pricePerSession: null,
  taxRate: 0.2,
  authorizationAmount: null,
  paymentFee: null,
  stationId: 'STATION-01',
  tariffAltText: null,
  tenantPartnerId: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  tenant: {
    countryCode: 'FR',
    partyId: 'HYX',
  },
};

const mockPartnerTariff = {
  ...mockCoreTariff,
  id: 2,
  tenantPartnerId: 42,
};

describe('TariffsService', () => {
  let service: TariffsService;
  let mockGraphqlClient: jest.Mocked<OcpiGraphqlClient>;

  beforeEach(() => {
    mockGraphqlClient = {
      request: jest.fn(),
    } as any;
    service = new TariffsService(mockGraphqlClient);
  });

  describe('getTariffByKey', () => {
    it('should return a mapped TariffDTO when tariff is found', async () => {
      mockGraphqlClient.request.mockResolvedValue({
        Tariffs: [mockCoreTariff],
      });

      const result = await service.getTariffByKey({
        id: 1,
        countryCode: 'FR',
        partyId: 'HYX',
      });

      expect(mockGraphqlClient.request).toHaveBeenCalledWith(
        GET_TARIFF_BY_KEY_QUERY,
        { id: 1, countryCode: 'FR', partyId: 'HYX' },
      );
      expect(result).toBeDefined();
      expect(result!.id).toBe('1');
      expect(result!.currency).toBe('EUR');
      expect(result!.country_code).toBe('FR');
      expect(result!.party_id).toBe('HYX');
    });

    it('should return undefined when tariff is not found', async () => {
      mockGraphqlClient.request.mockResolvedValue({
        Tariffs: [],
      });

      const result = await service.getTariffByKey({
        id: 999,
        countryCode: 'FR',
        partyId: 'HYX',
      });

      expect(result).toBeUndefined();
    });
  });

  describe('getTariffByOcpiId', () => {
    it('should use GET_TARIFF_BY_OCPI_ID_QUERY by default (tenant lookup)', async () => {
      mockGraphqlClient.request.mockResolvedValue({
        Tariffs: [mockCoreTariff],
      });

      const result = await service.getTariffByOcpiId('FR', 'HYX', '1');

      expect(mockGraphqlClient.request).toHaveBeenCalledWith(
        GET_TARIFF_BY_OCPI_ID_QUERY,
        { tariffId: 1, countryCode: 'FR', partyId: 'HYX' },
      );
      expect(result).toBeDefined();
      expect(result!.id).toBe('1');
    });

    it('should resolve TenantPartner id then GET_TARIFF_BY_PARTNER_QUERY when isPartnerLookup is true', async () => {
      mockGraphqlClient.request
        .mockResolvedValueOnce({ TenantPartners: [{ id: 42 }] })
        .mockResolvedValueOnce({ Tariffs: [mockPartnerTariff] });

      const result = await service.getTariffByOcpiId('DE', 'CPO', '2', true);

      expect(mockGraphqlClient.request).toHaveBeenNthCalledWith(
        1,
        GET_TENANT_PARTNER_ID_BY_COUNTRY_PARTY,
        { countryCode: 'DE', partyId: 'CPO' },
      );
      expect(mockGraphqlClient.request).toHaveBeenNthCalledWith(
        2,
        GET_TARIFF_BY_PARTNER_QUERY,
        { tariffId: 2, tenantPartnerId: 42 },
      );
      expect(result).toBeDefined();
      expect(result!.id).toBe('2');
    });

    it('should return undefined when tariff is not found', async () => {
      mockGraphqlClient.request.mockResolvedValue({
        Tariffs: [],
      });

      const result = await service.getTariffByOcpiId('FR', 'HYX', '999');

      expect(result).toBeUndefined();
    });
  });

  describe('getTariffs', () => {
    it('should return paginated tariffs with tenantPartnerId IS NULL filter', async () => {
      mockGraphqlClient.request.mockResolvedValue({
        Tariffs: [mockCoreTariff, { ...mockCoreTariff, id: 2 }],
      });

      const ocpiHeaders = new OcpiHeaders('DE', 'ABC', 'FR', 'HYX');

      const paginatedParams = new PaginatedParams();
      paginatedParams.limit = 10;
      paginatedParams.offset = 0;

      const result = await service.getTariffs(ocpiHeaders, paginatedParams);

      expect(mockGraphqlClient.request).toHaveBeenCalledWith(
        GET_TARIFFS_QUERY,
        expect.objectContaining({
          where: expect.objectContaining({
            tenantPartnerId: { _is_null: true },
            Tenant: {
              countryCode: { _eq: 'FR' },
              partyId: { _eq: 'HYX' },
            },
          }),
        }),
      );
      expect(result.data).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(result.data[0].id).toBe('1');
      expect(result.data[1].id).toBe('2');
    });

    it('should apply date filters when provided', async () => {
      mockGraphqlClient.request.mockResolvedValue({
        Tariffs: [],
      });

      const ocpiHeaders = new OcpiHeaders('DE', 'ABC', 'FR', 'HYX');

      const dateFrom = new Date('2024-01-01');
      const dateTo = new Date('2024-12-31');

      const paginatedParams = new PaginatedParams();
      paginatedParams.limit = 10;
      paginatedParams.offset = 0;
      paginatedParams.dateFrom = dateFrom;
      paginatedParams.dateTo = dateTo;

      await service.getTariffs(ocpiHeaders, paginatedParams);

      expect(mockGraphqlClient.request).toHaveBeenCalledWith(
        GET_TARIFFS_QUERY,
        expect.objectContaining({
          where: expect.objectContaining({
            updatedAt: {
              _gte: dateFrom.toISOString(),
              _lte: dateTo.toISOString(),
            },
            tenantPartnerId: { _is_null: true },
          }),
        }),
      );
    });
  });

  describe('createOrUpdateTariff', () => {
    it('should create or update a tariff and return the mapped result', async () => {
      mockGraphqlClient.request.mockResolvedValue({
        insert_Tariffs_one: mockCoreTariff,
      });

      const result = await service.createOrUpdateTariff({
        id: '1',
        country_code: 'FR',
        party_id: 'HYX',
        currency: 'EUR',
        elements: [
          {
            price_components: [
              {
                type: TariffDimensionType.ENERGY,
                price: 0.25,
                step_size: 1,
              },
            ],
          },
        ],
      });

      expect(mockGraphqlClient.request).toHaveBeenCalledWith(
        CREATE_OR_UPDATE_TARIFF_MUTATION,
        expect.objectContaining({
          object: expect.objectContaining({
            id: 1,
            currency: 'EUR',
          }),
        }),
      );
      expect(result.id).toBe('1');
      expect(result.currency).toBe('EUR');
    });

    it('should pass tenantPartnerId to the mutation when provided', async () => {
      mockGraphqlClient.request.mockResolvedValue({
        insert_Tariffs_one: mockPartnerTariff,
      });

      await service.createOrUpdateTariff(
        {
          id: '2',
          country_code: 'DE',
          party_id: 'CPO',
          currency: 'EUR',
          elements: [
            {
              price_components: [
                {
                  type: TariffDimensionType.ENERGY,
                  price: 0.3,
                  step_size: 1,
                },
              ],
            },
          ],
        },
        10,
        42,
      );

      expect(mockGraphqlClient.request).toHaveBeenCalledWith(
        CREATE_OR_UPDATE_TARIFF_MUTATION,
        expect.objectContaining({
          object: expect.objectContaining({
            id: 2,
            tenantId: 10,
            tenantPartnerId: 42,
          }),
        }),
      );
    });

    it('should not include tenantPartnerId when not provided', async () => {
      mockGraphqlClient.request.mockResolvedValue({
        insert_Tariffs_one: mockCoreTariff,
      });

      await service.createOrUpdateTariff(
        {
          id: '1',
          country_code: 'FR',
          party_id: 'HYX',
          currency: 'EUR',
          elements: [
            {
              price_components: [
                {
                  type: TariffDimensionType.ENERGY,
                  price: 0.25,
                  step_size: 1,
                },
              ],
            },
          ],
        },
        10,
      );

      const callArgs = mockGraphqlClient.request.mock.calls[0][1] as any;
      expect(callArgs.object.tenantId).toBe(10);
      expect(callArgs.object.tenantPartnerId).toBeUndefined();
    });

    it('should throw when mutation returns null', async () => {
      mockGraphqlClient.request.mockResolvedValue({
        insert_Tariffs_one: null,
      });

      await expect(
        service.createOrUpdateTariff({
          id: '1',
          country_code: 'FR',
          party_id: 'HYX',
          currency: 'EUR',
          elements: [
            {
              price_components: [
                {
                  type: TariffDimensionType.ENERGY,
                  price: 0.25,
                  step_size: 1,
                },
              ],
            },
          ],
        }),
      ).rejects.toThrow('Failed to create or update tariff 1');
    });
  });

  describe('deleteTariff', () => {
    it('should look up the tariff via tenant and delete it', async () => {
      mockGraphqlClient.request
        .mockResolvedValueOnce({ Tariffs: [mockCoreTariff] })
        .mockResolvedValueOnce({ delete_Tariffs_by_pk: { id: 1 } });

      await service.deleteTariff('FR', 'HYX', '1');

      expect(mockGraphqlClient.request).toHaveBeenCalledWith(
        GET_TARIFF_BY_OCPI_ID_QUERY,
        { tariffId: 1, countryCode: 'FR', partyId: 'HYX' },
      );
      expect(mockGraphqlClient.request).toHaveBeenCalledWith(
        DELETE_TARIFF_MUTATION,
        { id: 1 },
      );
    });

    it('should look up the tariff via partner and delete it', async () => {
      mockGraphqlClient.request
        .mockResolvedValueOnce({ TenantPartners: [{ id: 42 }] })
        .mockResolvedValueOnce({ Tariffs: [mockPartnerTariff] })
        .mockResolvedValueOnce({ delete_Tariffs_by_pk: { id: 2 } });

      await service.deleteTariff('DE', 'CPO', '2', true);

      expect(mockGraphqlClient.request).toHaveBeenNthCalledWith(
        1,
        GET_TENANT_PARTNER_ID_BY_COUNTRY_PARTY,
        { countryCode: 'DE', partyId: 'CPO' },
      );
      expect(mockGraphqlClient.request).toHaveBeenNthCalledWith(
        2,
        GET_TARIFF_BY_PARTNER_QUERY,
        { tariffId: 2, tenantPartnerId: 42 },
      );
      expect(mockGraphqlClient.request).toHaveBeenNthCalledWith(
        3,
        DELETE_TARIFF_MUTATION,
        { id: 2 },
      );
    });

    it('should throw when tariff is not found', async () => {
      mockGraphqlClient.request.mockResolvedValue({ Tariffs: [] });

      await expect(service.deleteTariff('FR', 'HYX', '999')).rejects.toThrow(
        'Tariff 999 not found for FR/HYX',
      );
    });
  });
});
