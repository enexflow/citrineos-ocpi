// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// @zetra/citrineos-base is ESM-only and Jest's CJS runtime cannot parse it
// (see SessionMapper.test.ts): stub the enums the mappers use.
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
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { CdrMapper } from '../CdrMapper';
import { SessionMapper } from '../SessionMapper';
import { roundOcpiNumber } from '../../util/Util';
import { CdrDimensionType } from '../../model/CdrDimensionType';
import type { Session } from '../../model/Session';
import type { LocationDTO } from '../../model/DTO/LocationDTO';
import type { LocationsService } from '../../services/LocationsService';
import type { OcpiGraphqlClient } from '../../graphql';

const energyReading = (timestamp: string, energyWh: number): MeterValueDto =>
  ({
    timestamp,
    sampledValue: [
      {
        value: energyWh,
        measurand: 'Energy.Active.Import.Register',
        unitOfMeasure: { unit: 'Wh', multiplier: 0 },
      },
    ],
  }) as unknown as MeterValueDto;

describe('CdrMapper.mapSessionToCDR', () => {
  const logger = new Logger<ILogObj>({ type: 'hidden' });
  const warn = jest.spyOn(logger, 'warn');
  const sessionMapper = new SessionMapper(
    logger,
    {} as LocationsService,
    {} as OcpiGraphqlClient,
  );
  const cdrMapper = new CdrMapper(
    logger,
    {} as LocationsService,
    {} as OcpiGraphqlClient,
    sessionMapper,
  );

  // Odd timestamps so that unrounded and rounded durations differ
  const start = new Date('2026-10-29T10:00:07.123Z');
  const end = new Date('2026-10-29T10:59:58.456Z');
  const connector = {
    id: '1',
    standard: 'IEC_62196_T2',
    format: 'SOCKET',
    power_type: 'AC_3_PHASE',
  };
  const location = (connectorOverrides: Record<string, unknown> = {}) =>
    ({
      id: 'LOC-1',
      name: 'Station',
      address: '1 rue de la Paix',
      city: 'Paris',
      postal_code: '75001',
      country: 'FRA',
      coordinates: { latitude: '48.8', longitude: '2.3' },
      evses: [
        {
          uid: 'EVSE-1',
          evse_id: 'FR*ZET*E1',
          connectors: [{ ...connector, ...connectorOverrides }],
        },
      ],
    }) as unknown as LocationDTO;
  const session = (overrides: Partial<Session> = {}): Session =>
    ({
      country_code: 'FR',
      party_id: 'ZET',
      id: 'TX-1',
      start_date_time: start,
      end_date_time: end,
      kwh: 6,
      evse_uid: 'EVSE-1',
      connector_id: '1',
      currency: 'EUR',
      last_updated: new Date('2026-10-29T11:00:00.000Z'),
      charging_periods: sessionMapper.getChargingPeriods(
        [
          energyReading('2026-10-29T10:13:41.789Z', 101000),
          energyReading('2026-10-29T10:37:12.321Z', 104000),
        ],
        'FRZETT003927',
        { timestamp: start, energyKwh: 100 },
        { timestamp: end, totalKwh: 6 },
      ),
      ...overrides,
    }) as unknown as Session;
  const toCdr = (s: Session, l: LocationDTO = location()) =>
    cdrMapper['mapSessionToCDR'](s, l, {} as any, {} as any);

  beforeEach(() => warn.mockClear());

  it('gives a total_time equal to the sum of the period TIME volumes', async () => {
    const cdr = await toCdr(session());
    const periodTime = cdr.charging_periods.reduce(
      (sum, period) =>
        sum +
        (period.dimensions.find((d) => d.type === CdrDimensionType.TIME)
          ?.volume ?? 0),
      0,
    );

    expect(cdr.charging_periods).toHaveLength(3);
    expect(cdr.total_time).toBe(roundOcpiNumber(periodTime));
  });

  it('warns when cdr_location misses a field OCPI requires', async () => {
    await toCdr(session(), location({ format: undefined }));

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /CDR TX-1: cdr_location is missing connector_format/,
      ),
    );
  });

  it('does not warn when the EVSE/connector data is complete', async () => {
    await toCdr(session());

    expect(warn).not.toHaveBeenCalled();
  });
});
