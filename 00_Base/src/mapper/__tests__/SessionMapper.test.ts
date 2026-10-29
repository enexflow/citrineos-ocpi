// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// @zetra/citrineos-base is ESM-only and Jest's CJS runtime cannot parse it
// (see SessionsService.test.ts): stub the enums SessionMapper uses.
jest.mock('@zetra/citrineos-base', () => ({
  OCPP2_0_1: {
    MeasurandEnumType: {
      Current_Import: 'Current.Import',
      Energy_Active_Import_Register: 'Energy.Active.Import.Register',
      SoC: 'SoC',
    },
  },
  ChargingStateEnum: { EVConnected: 'EVConnected' },
}));
jest.mock('../../services/LocationsService', () => ({
  LocationsService: class {},
}));
jest.mock('../../graphql/index', () => ({ OcpiGraphqlClient: class {} }));

import type { MeterValueDto } from '@zetra/citrineos-base';
import { Logger } from 'tslog';
import { SessionMapper } from '../SessionMapper';
import { roundOcpiNumber, toRoundedHours } from '../../util/Util';
import { CdrDimensionType } from '../../model/CdrDimensionType';
import type { LocationsService } from '../../services/LocationsService';
import type { OcpiGraphqlClient } from '../../graphql';

const energyReading = (timestamp: string, energyWh: number): MeterValueDto =>
  ({
    timestamp,
    sampledValue: [
      {
        value: energyWh,
        context: 'Sample.Periodic',
        measurand: 'Energy.Active.Import.Register',
        location: 'Outlet',
        unitOfMeasure: { unit: 'Wh', multiplier: 0 },
      },
    ],
  }) as unknown as MeterValueDto;

const energyOf = (dimensions: { type: string; volume: number }[]) =>
  dimensions.find((d) => d.type === CdrDimensionType.ENERGY)?.volume;

const timeOf = (dimensions: { type: string; volume: number }[]) =>
  dimensions.find((d) => d.type === CdrDimensionType.TIME)?.volume;

describe('SessionMapper.getChargingPeriods', () => {
  const mapper = new SessionMapper(
    new Logger({ type: 'hidden' }),
    {} as LocationsService,
    {} as OcpiGraphqlClient,
  );

  it('gives one charging period per timestamp when a reading is repeated (1.6 StopTransaction transactionData)', () => {
    const periodic = [
      energyReading('2026-10-29T10:00:05.169Z', 48636.6),
      energyReading('2026-10-29T10:00:14.688Z', 49164.34),
      energyReading('2026-10-29T10:00:25.000Z', 49700),
    ];
    const repeatedAtStop = periodic.map((mv) =>
      energyReading(mv.timestamp, Number(mv.sampledValue[0].value)),
    );

    const periods = mapper.getChargingPeriods(
      [...periodic, ...repeatedAtStop],
      'FRZETT003927',
    );

    expect(periods.map((p) => p.start_date_time.toISOString())).toEqual([
      '2026-10-29T10:00:05.169Z',
      '2026-10-29T10:00:14.688Z',
    ]);
    expect(energyOf(periods[0].dimensions)).toBe(0.5277);
    expect(energyOf(periods[1].dimensions)).toBe(0.5357);
  });

  it('gives each period the energy charged until the next period starts, in kWh', () => {
    const periods = mapper.getChargingPeriods(
      [
        energyReading('2026-10-29T10:00:00.000Z', 1000),
        energyReading('2026-10-29T10:30:00.000Z', 6000),
        energyReading('2026-10-29T11:00:00.000Z', 8000),
      ],
      'FRZETT003927',
    );

    expect(periods.map((p) => p.start_date_time.toISOString())).toEqual([
      '2026-10-29T10:00:00.000Z',
      '2026-10-29T10:30:00.000Z',
    ]);
    expect(energyOf(periods[0].dimensions)).toBeCloseTo(5, 5);
    expect(timeOf(periods[0].dimensions)).toBeCloseTo(0.5, 5);
    expect(energyOf(periods[1].dimensions)).toBeCloseTo(2, 5);
  });

  it('covers the energy charged between session start (meterStart) and the first reading', () => {
    // meterStart is stored in kWh on the core Transaction
    const periods = mapper.getChargingPeriods(
      [
        energyReading('2026-10-29T10:00:05.169Z', 48636.6),
        energyReading('2026-10-29T10:00:14.688Z', 49164.34),
      ],
      'FRZETT003927',
      { timestamp: new Date('2026-10-29T10:00:00.000Z'), energyKwh: 48.3036 },
    );

    expect(periods[0].start_date_time.toISOString()).toBe(
      '2026-10-29T10:00:00.000Z',
    );
    expect(energyOf(periods[0].dimensions)).toBeCloseTo(0.333, 5);
    const total = periods.reduce(
      (sum, p) => sum + (energyOf(p.dimensions) ?? 0),
      0,
    );
    expect(total).toBeCloseTo(0.8607, 4);
    expect(
      periods[1].dimensions.find(
        (d) => d.type === CdrDimensionType.ENERGY_IMPORT,
      )?.volume,
    ).toBe(0.8607);
  });

  it('closes a finished session with a period from the last reading to meterStop', () => {
    // Session 11 (cp002): meterStart 0, last reading 27720.61 Wh, meterStop 27859 Wh
    const start = new Date('2026-10-29T13:02:24.524Z');
    const end = new Date('2026-10-29T13:10:59.994Z');
    const periods = mapper.getChargingPeriods(
      [
        energyReading('2026-10-29T13:02:34.036Z', 0.61),
        energyReading('2026-10-29T13:10:54.224Z', 27720.61),
      ],
      'FRZETT003927',
      { timestamp: start, energyKwh: 0 },
      { timestamp: end, totalKwh: 27.859 },
    );

    expect(periods.map((p) => p.start_date_time.toISOString())).toEqual([
      '2026-10-29T13:02:24.524Z',
      '2026-10-29T13:02:34.036Z',
      '2026-10-29T13:10:54.224Z',
    ]);
    expect(energyOf(periods[2].dimensions)).toBe(0.1384);
    const sum = (type: string) =>
      periods.reduce(
        (s, p) => s + (p.dimensions.find((d) => d.type === type)?.volume ?? 0),
        0,
      );
    expect(sum(CdrDimensionType.ENERGY)).toBeCloseTo(27.859, 10);
    // Same value CdrMapper reports as total_time
    expect(sum(CdrDimensionType.TIME)).toBeCloseTo(
      roundOcpiNumber(toRoundedHours(end) - toRoundedHours(start)),
      10,
    );
    // OCPI §16.4: numbers use 4 decimals
    for (const period of periods) {
      for (const dimension of period.dimensions) {
        expect(roundOcpiNumber(dimension.volume)).toBe(dimension.volume);
      }
    }
  });

  it('does not add an end period when the last reading is at the session end', () => {
    const periods = mapper.getChargingPeriods(
      [
        energyReading('2026-10-29T10:00:00.000Z', 1000),
        energyReading('2026-10-29T10:30:00.000Z', 6000),
      ],
      'FRZETT003927',
      { timestamp: new Date('2026-10-29T10:00:00.000Z'), energyKwh: 1 },
      { timestamp: new Date('2026-10-29T10:30:00.000Z'), totalKwh: 5 },
    );

    expect(periods).toHaveLength(1);
  });

  it('ignores a meterStart above the first reading (stored in Wh before the core fix)', () => {
    // Transaction 2032: meterStart 27776 left in Wh, first reading 28026.64 Wh
    const periods = mapper.getChargingPeriods(
      [
        energyReading('2026-10-29T09:10:45.346Z', 28026.64),
        energyReading('2026-10-29T09:10:55.367Z', 28582.15),
      ],
      'FRZETT003927',
      { timestamp: new Date('2026-10-29T09:10:35.778Z'), energyKwh: 27776 },
      { timestamp: new Date('2026-10-29T09:16:14.444Z'), totalKwh: 18.305 },
    );

    // start and end periods only carry TIME, no absurd energy
    expect(periods).toHaveLength(3);
    expect(energyOf(periods[0].dimensions)).toBeUndefined();
    expect(energyOf(periods[1].dimensions)).toBe(0.5556);
    expect(energyOf(periods[2].dimensions)).toBeUndefined();
    for (const period of periods) {
      expect(
        period.dimensions.find(
          (d) => d.type === CdrDimensionType.ENERGY_IMPORT,
        ),
      ).toBeUndefined();
    }
  });

  it('does not add a start period when the session starts at the first reading', () => {
    const periods = mapper.getChargingPeriods(
      [
        energyReading('2026-10-29T10:00:00.000Z', 1000),
        energyReading('2026-10-29T10:30:00.000Z', 6000),
      ],
      'FRZETT003927',
      { timestamp: new Date('2026-10-29T10:00:00.000Z'), energyKwh: 1 },
    );

    expect(periods).toHaveLength(1);
    expect(energyOf(periods[0].dimensions)).toBeCloseTo(5, 5);
  });

  it('normalizes kWh registers and unit multipliers', () => {
    const kwhReading = (timestamp: string, value: number, multiplier = 0) =>
      ({
        timestamp,
        sampledValue: [
          {
            value,
            measurand: 'Energy.Active.Import.Register',
            unitOfMeasure: { unit: 'kWh', multiplier },
          },
        ],
      }) as unknown as MeterValueDto;

    const periods = mapper.getChargingPeriods(
      [
        kwhReading('2026-10-29T10:00:00.000Z', 10),
        kwhReading('2026-10-29T10:30:00.000Z', 1.25, 1),
      ],
      'FRZETT003927',
    );

    expect(energyOf(periods[0].dimensions)).toBeCloseTo(2.5, 5);
  });

  it('merges different measurands sent at the same timestamp into one period', () => {
    const stateOfCharge = {
      timestamp: '2026-10-29T10:00:14.688Z',
      sampledValue: [
        {
          value: 80,
          context: 'Sample.Periodic',
          measurand: 'SoC',
          location: 'EV',
          unitOfMeasure: { unit: 'Percent', multiplier: 0 },
        },
      ],
    } as unknown as MeterValueDto;

    const periods = mapper.getChargingPeriods(
      [
        energyReading('2026-10-29T10:00:05.169Z', 48636.6),
        energyReading('2026-10-29T10:00:14.688Z', 49164.34),
        stateOfCharge,
      ],
      'FRZETT003927',
    );

    expect(periods).toHaveLength(1);
    expect(periods[0].dimensions.map((d) => d.type)).toEqual(
      expect.arrayContaining([
        CdrDimensionType.ENERGY,
        CdrDimensionType.STATE_OF_CHARGE,
      ]),
    );
  });

  it('does not reorder the caller array', () => {
    const input = [
      energyReading('2026-10-29T10:00:14.688Z', 49164.34),
      energyReading('2026-10-29T10:00:05.169Z', 48636.6),
    ];
    mapper.getChargingPeriods(input, 'FRZETT003927');
    expect(input[0].timestamp).toBe('2026-10-29T10:00:14.688Z');
  });
});
