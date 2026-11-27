// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// @zetra/citrineos-base is ESM-only and Jest's CJS runtime cannot parse it
// (see SessionMapper.test.ts). LocationMapper only reads its enums inside
// methods, never at module load, and mapLocationHours uses none of them:
// an empty stub is enough. Add the enums here if a test reaches other mappers.
jest.mock('@zetra/citrineos-base', () => ({}));

import type { LocationHours } from '@zetra/citrineos-base';
import { Logger } from 'tslog';
import { Container } from 'typedi';
import { ConnectorMapper, LocationMapper } from '../LocationMapper';
import { HoursSchema } from '../../model/Hours';

const hours = (value: Partial<LocationHours>): LocationHours =>
  value as LocationHours;

describe('LocationMapper.mapLocationHours', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    const logger = new Logger({ type: 'hidden' });
    warn = jest.spyOn(logger, 'warn');
    Container.set(Logger, logger);
  });

  it('maps regular hours to OCPI snake_case with an explicit twentyfourseven', () => {
    const result = LocationMapper.mapLocationHours(
      hours({
        twentyfourSeven: false,
        regularHours: [
          { weekday: 1, periodBegin: '08:00', periodEnd: '12:00' },
          { weekday: 1, periodBegin: '14:00', periodEnd: '23:59' },
        ],
      }),
    );

    expect(result).toEqual({
      twentyfourseven: false,
      regular_hours: [
        { weekday: 1, period_begin: '08:00', period_end: '12:00' },
        { weekday: 1, period_begin: '14:00', period_end: '23:59' },
      ],
      exceptional_openings: undefined,
      exceptional_closings: undefined,
    });
    expect(HoursSchema.safeParse(result).success).toBe(true);
  });

  it('drops regular hours when the location is open 24/7', () => {
    const result = LocationMapper.mapLocationHours(
      hours({
        twentyfourSeven: true,
        regularHours: [
          { weekday: 1, periodBegin: '08:00', periodEnd: '12:00' },
        ],
      }),
    );

    expect(result?.twentyfourseven).toBe(true);
    expect(result?.regular_hours).toBeUndefined();
    expect(HoursSchema.safeParse(result).success).toBe(true);
  });

  it.each([
    [
      'empty regular hours',
      hours({ twentyfourSeven: false, regularHours: [] }),
    ],
    ['no regular hours', hours({ twentyfourSeven: false })],
    ['missing twentyfourSeven', hours({})],
  ])(
    'omits opening_times rather than sending invalid Hours (%s)',
    (_, input) => {
      expect(LocationMapper.mapLocationHours(input)).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it('logs the location and the exceptional periods it drops', () => {
    const period = {
      periodBegin: new Date('2026-12-24T18:00:00Z'),
      periodEnd: new Date('2026-12-26T06:00:00Z'),
    };

    LocationMapper.mapLocationHours(
      hours({ twentyfourSeven: false, exceptionalClosings: [period] }),
      42,
    );

    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      locationId: 42,
      droppedExceptionalOpenings: 0,
      droppedExceptionalClosings: 1,
    });
  });

  it('treats a missing twentyfourSeven flag as false', () => {
    const result = LocationMapper.mapLocationHours(
      hours({
        regularHours: [
          { weekday: 7, periodBegin: '09:00', periodEnd: '17:00' },
        ],
      }),
    );

    expect(result?.twentyfourseven).toBe(false);
    expect(HoursSchema.safeParse(result).success).toBe(true);
  });

  it('keeps exceptional periods', () => {
    const begin = new Date('2026-12-24T18:00:00Z');
    const end = new Date('2026-12-26T06:00:00Z');

    const result = LocationMapper.mapLocationHours(
      hours({
        twentyfourSeven: true,
        exceptionalClosings: [{ periodBegin: begin, periodEnd: end }],
      }),
    );

    expect(result?.exceptional_closings).toEqual([
      { period_begin: begin, period_end: end },
    ]);
  });
});

describe('ConnectorMapper.fromGraphql tariff_ids', () => {
  beforeEach(() => {
    Container.set(Logger, new Logger({ type: 'hidden' }));
    // Their enums come from the stubbed citrineos-base; only tariff_ids is under test here.
    jest.spyOn(ConnectorMapper, 'mapConnectorType').mockReturnValue(undefined);
    jest
      .spyOn(ConnectorMapper, 'mapConnectorFormat')
      .mockReturnValue(undefined);
    jest
      .spyOn(ConnectorMapper, 'mapConnectorPowerType')
      .mockReturnValue(undefined);
    jest
      .spyOn(ConnectorMapper, 'validatePartialConnector' as any)
      .mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const connector = (tariffs: unknown[]) =>
    ({
      id: 57,
      type: 'IEC_62196_T2_COMBO',
      format: 'CABLE',
      powerType: 'DC',
      maximumVoltage: 400,
      maximumAmperage: 200,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      tariffs,
    }) as any;

  it("sends the Tariff's stored id, never the link copy or the numeric id", () => {
    const mapped = ConnectorMapper.fromGraphql(
      connector([
        {
          tariffOcpiId: 'stale-copy',
          tariffId: 12,
          Tariff: { id: 12, ocpiTariffId: 'FR*ZET*T000012' },
        },
        {
          tariffOcpiId: 'FRZETT000005',
          tariffId: 5,
          Tariff: { id: 5, ocpiTariffId: 'FRZETT000005' },
        },
      ]),
    );

    expect(mapped?.tariff_ids).toEqual(['FR*ZET*T000012', 'FRZETT000005']);
  });

  it('fails loudly on a linked tariff with no OCPI id instead of sending its numeric id', () => {
    expect(() =>
      ConnectorMapper.fromGraphql(
        connector([{ tariffId: 12, Tariff: { id: 12, ocpiTariffId: null } }]),
      ),
    ).toThrow(/Tariff 12 has no ocpiTariffId/);
  });
});
