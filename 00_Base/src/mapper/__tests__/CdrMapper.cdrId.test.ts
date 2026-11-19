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

import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { CdrMapper } from '../CdrMapper';
import { SessionMapper } from '../SessionMapper';
import type { Session } from '../../model/Session';
import type { LocationDTO } from '../../model/DTO/LocationDTO';
import type { LocationsService } from '../../services/LocationsService';
import type { OcpiGraphqlClient } from '../../graphql';

describe('CdrMapper.generateCdrId', () => {
  const logger = new Logger<ILogObj>({ type: 'hidden' });
  const cdrMapper = new CdrMapper(
    logger,
    {} as LocationsService,
    {} as OcpiGraphqlClient,
    new SessionMapper(logger, {} as LocationsService, {} as OcpiGraphqlClient),
  );
  const session = {
    country_code: 'FR',
    party_id: 'ZET',
    id: 'TX-1',
  } as unknown as Session;
  const location = { id: 'LOC-1' } as unknown as LocationDTO;

  it('builds the CDR id from the Transactions PK and the location id', () => {
    expect(cdrMapper['generateCdrId'](session, 42, location)).toBe(
      'FR*ZET*F42*LOC-1',
    );
  });

  it('refuses to build a CDR id without a Transactions PK', () => {
    expect(() =>
      cdrMapper['generateCdrId'](session, undefined, location),
    ).toThrow('CDR TX-1: missing Transactions.id, cannot build CDR id');
  });
});
