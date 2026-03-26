// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { TariffMapper } from '../TariffMapper';
import { TariffDimensionType } from '../../model/TariffDimensionType';
import { TariffType } from '../../model/TariffType';
import type { TariffDto } from '@citrineos/base';
import type { PutTariffRequest } from '../../model/DTO/tariffs/PutTariffRequest';

describe('TariffMapper', () => {
  describe('map (core -> OCPI)', () => {
    it('should use ocpiTariffId when present (partner tariff)', () => {
      const coreTariff = {
        id: 42,
        ocpiTariffId: 'tariff-abc-123',
        currency: 'EUR',
        pricePerKwh: 0.25,
        taxRate: 0.2,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        tenant: {
          countryCode: 'FR',
          partyId: 'HYX',
        },
      } as any;

      const result = TariffMapper.map(coreTariff);

      expect(result.id).toBe('tariff-abc-123');
      expect(result.country_code).toBe('FR');
      expect(result.party_id).toBe('HYX');
    });

    it('should use ocpiTariffId with UUID format', () => {
      const coreTariff = {
        id: 99,
        ocpiTariffId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        currency: 'EUR',
        pricePerKwh: 0.18,
        taxRate: 0.2,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        tenant: {
          countryCode: 'DE',
          partyId: 'CPO',
        },
      } as any;

      const result = TariffMapper.map(coreTariff);

      expect(result.id).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    });

    it('should fall back to id.toString() when ocpiTariffId is absent (own tariff)', () => {
      const coreTariff: Partial<TariffDto> = {
        id: 1,
        currency: 'EUR',
        pricePerKwh: 0.25,
        taxRate: 0.2,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        tenant: {
          countryCode: 'FR',
          partyId: 'HYX',
        },
      } as Partial<TariffDto>;

      const result = TariffMapper.map(coreTariff);

      expect(result.id).toBe('1');
      expect(result.country_code).toBe('FR');
      expect(result.party_id).toBe('HYX');
      expect(result.currency).toBe('EUR');
      expect(result.type).toBe(TariffType.AD_HOC_PAYMENT);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].price_components).toHaveLength(1);
      expect(result.elements[0].price_components[0]).toEqual({
        type: TariffDimensionType.ENERGY,
        price: 0.25,
        vat: 0.2,
        step_size: 1,
      });
      expect(result.last_updated).toEqual(new Date('2024-01-01T00:00:00Z'));
    });

    it('should include TIME and FLAT components when pricePerMin and pricePerSession are set', () => {
      const coreTariff: Partial<TariffDto> = {
        id: 2,
        currency: 'EUR',
        pricePerKwh: 0.3,
        pricePerMin: 0.01,
        pricePerSession: 1.5,
        taxRate: 0.19,
        updatedAt: new Date('2024-06-15T12:00:00Z'),
        tenant: {
          countryCode: 'DE',
          partyId: 'ABC',
        },
      } as Partial<TariffDto>;

      const result = TariffMapper.map(coreTariff);

      expect(result.elements[0].price_components).toHaveLength(3);

      const energyComponent = result.elements[0].price_components.find(
        (pc) => pc.type === TariffDimensionType.ENERGY,
      );
      expect(energyComponent?.price).toBe(0.3);

      const timeComponent = result.elements[0].price_components.find(
        (pc) => pc.type === TariffDimensionType.TIME,
      );
      expect(timeComponent?.price).toBe(0.01 * 60);

      const flatComponent = result.elements[0].price_components.find(
        (pc) => pc.type === TariffDimensionType.FLAT,
      );
      expect(flatComponent?.price).toBe(1.5);
    });

    it('should map tariff_alt_text when present as an array', () => {
      const coreTariff: Partial<TariffDto> = {
        id: 3,
        currency: 'EUR',
        pricePerKwh: 0.2,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        tariffAltText: [{ language: 'en', text: 'Standard tariff' }] as any,
        tenant: {
          countryCode: 'FR',
          partyId: 'HYX',
        },
      } as Partial<TariffDto>;

      const result = TariffMapper.map(coreTariff);

      expect(result.tariff_alt_text).toEqual([
        { language: 'en', text: 'Standard tariff' },
      ]);
    });
  });

  describe('mapElementsToCoreTariff', () => {
    it('should extract core pricing from tariff elements', () => {
      const elements = [
        {
          price_components: [
            {
              type: TariffDimensionType.ENERGY,
              price: 0.3,
              vat: 0.19,
              step_size: 1,
            },
            {
              type: TariffDimensionType.TIME,
              price: 0.6,
              vat: 0.19,
              step_size: 1,
            },
            {
              type: TariffDimensionType.FLAT,
              price: 2.0,
              vat: 0.19,
              step_size: 1,
            },
          ],
        },
      ];

      const result = TariffMapper.mapElementsToCoreTariff(elements);

      expect(result.pricePerKwh).toBe(0.3);
      expect(result.pricePerMin).toBe(0.6 / 60);
      expect(result.pricePerSession).toBe(2.0);
      expect(result.taxRate).toBe(0.19);
    });

    it('should return zeros for missing price components', () => {
      const elements = [
        {
          price_components: [],
        },
      ];

      const result = TariffMapper.mapElementsToCoreTariff(elements);

      expect(result.pricePerKwh).toBe(0);
      expect(result.pricePerMin).toBe(0);
      expect(result.pricePerSession).toBe(0);
      expect(result.taxRate).toBe(0);
    });
  });

  describe('mapFromOcpi (OCPI -> core)', () => {
    it('should store OCPI tariff id as ocpiTariffId string and NOT as numeric id', () => {
      const ocpiTariff: PutTariffRequest = {
        id: 'tariff-abc-123',
        country_code: 'FR',
        party_id: 'HYX',
        currency: 'EUR',
        type: TariffType.AD_HOC_PAYMENT,
        elements: [
          {
            price_components: [
              {
                type: TariffDimensionType.ENERGY,
                price: 0.25,
                vat: 0.2,
                step_size: 1,
              },
            ],
          },
        ],
      };

      const result = TariffMapper.mapFromOcpi(ocpiTariff);

      expect(result.ocpiTariffId).toBe('tariff-abc-123');
      expect(result.id).toBeUndefined();
      expect(result.currency).toBe('EUR');
      expect(result.pricePerKwh).toBe(0.25);
      expect(result.taxRate).toBe(0.2);
    });

    it('should handle UUID-format OCPI tariff ids', () => {
      const ocpiTariff: PutTariffRequest = {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        country_code: 'DE',
        party_id: 'XYZ',
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
      };

      const result = TariffMapper.mapFromOcpi(ocpiTariff);

      expect(result.ocpiTariffId).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
      expect(result.id).toBeUndefined();
    });

    it('should include tariff_alt_text if present', () => {
      const ocpiTariff: PutTariffRequest = {
        id: 'tariff-alt-text-test',
        country_code: 'DE',
        party_id: 'XYZ',
        currency: 'EUR',
        tariff_alt_text: [{ language: 'de', text: 'Standardtarif' }],
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
      };

      const result = TariffMapper.mapFromOcpi(ocpiTariff);

      expect(JSON.parse(result.tariffAltText as unknown as string)).toEqual([
        { language: 'de', text: 'Standardtarif' },
      ]);
    });

    it('should include tenantId and tenantPartnerId when provided', () => {
      const ocpiTariff: PutTariffRequest = {
        id: 'partner-tariff-55',
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
      };

      const result = TariffMapper.mapFromOcpi(ocpiTariff, 10, 42);

      expect(result.ocpiTariffId).toBe('partner-tariff-55');
      expect(result.id).toBeUndefined();
      expect((result as any).tenantId).toBe(10);
      expect((result as any).tenantPartnerId).toBe(42);
    });

    it('should not include tenantPartnerId when not provided', () => {
      const ocpiTariff: PutTariffRequest = {
        id: 'own-tariff-56',
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
      };

      const result = TariffMapper.mapFromOcpi(ocpiTariff, 10);

      expect((result as any).tenantId).toBe(10);
      expect((result as any).tenantPartnerId).toBeUndefined();
    });
  });

  describe('round-trip mapping', () => {
    it('should preserve core pricing through map -> mapFromOcpi round trip', () => {
      const coreTariff: Partial<TariffDto> = {
        id: 10,
        currency: 'EUR',
        pricePerKwh: 0.25,
        pricePerMin: 0.02,
        pricePerSession: 1.0,
        taxRate: 0.2,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        tenant: {
          countryCode: 'FR',
          partyId: 'HYX',
        },
      } as Partial<TariffDto>;

      const ocpiTariff = TariffMapper.map(coreTariff);
      const backToCore = TariffMapper.mapFromOcpi({
        ...ocpiTariff,
      });

      expect(backToCore.pricePerKwh).toBeCloseTo(0.25, 10);
      expect(backToCore.pricePerMin).toBeCloseTo(0.02, 10);
      expect(backToCore.pricePerSession).toBeCloseTo(1.0, 10);
      expect(backToCore.taxRate).toBeCloseTo(0.2, 10);
      expect(backToCore.currency).toBe('EUR');
    });
  });
});
