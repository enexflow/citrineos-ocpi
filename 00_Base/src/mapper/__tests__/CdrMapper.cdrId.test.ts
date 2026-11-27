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

import type { TariffDto, TransactionDto } from '@zetra/citrineos-base';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { CdrMapper } from '../CdrMapper';
import { SessionMapper } from '../SessionMapper';
import type { LocationDTO } from '../../model/DTO/LocationDTO';
import type { TokenDTO } from '../../model/DTO/TokenDTO';
import type { LocationsService } from '../../services/LocationsService';
import type { OcpiGraphqlClient } from '../../graphql';

/**
 * Session and CDR ids (TECH-2907): FR*ZET*R{Transactions.id} / FR*ZET*F{Transactions.id}.
 * The OCPP transactionId only is unique per station, so two stations can both send "1".
 */
describe('CdrMapper.mapTransactionsToCdrs ids', () => {
  const logger = new Logger<ILogObj>({ type: 'hidden' });
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

  const transaction = (id: number, stationId: string): TransactionDto =>
    ({
      id,
      // Same OCPP transactionId on both stations
      transactionId: '1',
      tenant: { countryCode: 'FR', partyId: 'ZET' },
      stationId,
      evseId: 1,
      connectorId: 1,
      isActive: false,
      totalKwh: 6,
      startTime: '2026-10-29T10:00:00.000Z',
      endTime: '2026-10-29T11:00:00.000Z',
      updatedAt: '2026-10-29T11:00:00.000Z',
      meterValues: [],
      location: {
        chargingPool: [{ id: stationId, evses: [{ id: 1, evseTypeId: 1 }] }],
      },
    }) as unknown as TransactionDto;
  const location = (id: string, stationId: string): LocationDTO =>
    ({
      id,
      country_code: 'FR',
      party_id: 'ZET',
      name: id,
      address: '1 rue de la Paix',
      city: 'Paris',
      postal_code: '75001',
      country: 'FRA',
      coordinates: { latitude: '48.8', longitude: '2.3' },
      evses: [
        {
          uid: `${stationId}::1`,
          evse_id: `FR*ZET*E${id}`,
          connectors: [
            {
              id: '1',
              standard: 'IEC_62196_T2',
              format: 'SOCKET',
              power_type: 'AC_3_PHASE',
            },
          ],
        },
      ],
    }) as unknown as LocationDTO;
  const token = { uid: 'TOKEN', type: 'RFID' } as unknown as TokenDTO;
  const tariff = {
    id: 7,
    currency: 'EUR',
    ocpiTariffId: 'FRZETT003927',
  } as unknown as TariffDto;

  const transactions = [transaction(9876, 'CS-A'), transaction(9877, 'CS-B')];
  // Context maps are keyed by the OCPI session id
  const locations = new Map([
    ['FR*ZET*R009876', location('LOC-A', 'CS-A')],
    ['FR*ZET*R009877', location('LOC-B', 'CS-B')],
  ]);
  const tariffs = new Map([
    ['FR*ZET*R009876', tariff],
    ['FR*ZET*R009877', tariff],
  ]);

  beforeEach(() => {
    jest
      .spyOn(sessionMapper, 'getLocationsTokensAndTariffsMapsForTransactions')
      .mockResolvedValue([
        locations,
        new Map([
          ['FR*ZET*R009876', token],
          ['FR*ZET*R009877', token],
        ]),
        tariffs,
      ]);
    jest
      .spyOn(cdrMapper, 'getLocationDTOsForTransactions')
      .mockResolvedValue(locations);
    jest
      .spyOn(cdrMapper as any, 'getTariffsForTransactions')
      .mockResolvedValue(tariffs);
    jest
      .spyOn(cdrMapper as any, 'getOcpiTariffsForTransactions')
      .mockResolvedValue(
        new Map([
          ['FR*ZET*R009876', { id: 'FRZETT003927' }],
          ['FR*ZET*R009877', { id: 'FRZETT003927' }],
        ]),
      );
  });

  it('builds the CDR id from Transactions.id, without the location suffix', async () => {
    const cdrs = await cdrMapper.mapTransactionsToCdrs(transactions);

    expect(cdrs.map((cdr) => cdr.id)).toEqual([
      'FR*ZET*F009876',
      'FR*ZET*F009877',
    ]);
  });

  it("gives the CDR its session's id as session_id, with the same number", async () => {
    const [sessions, cdrs] = await Promise.all([
      sessionMapper.mapTransactionsToSessions(transactions),
      cdrMapper.mapTransactionsToCdrs(transactions),
    ]);

    expect(sessions.map((session) => session.id)).toEqual([
      'FR*ZET*R009876',
      'FR*ZET*R009877',
    ]);
    expect(cdrs.map((cdr) => cdr.session_id)).toEqual(
      sessions.map((session) => session.id),
    );
  });

  it('keeps the context of each transaction when two stations send the same transactionId', async () => {
    const cdrs = await cdrMapper.mapTransactionsToCdrs(transactions);

    expect(cdrs.map((cdr) => cdr.cdr_location.id)).toEqual(['LOC-A', 'LOC-B']);
    expect(cdrs.map((cdr) => cdr.cdr_location.evse_uid)).toEqual([
      'CS-A::1',
      'CS-B::1',
    ]);
  });
});
