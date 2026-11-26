// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// @zetra/citrineos-base is ESM-only and Jest's CJS runtime cannot parse it
// (see TokensService.test.ts): stub the enums the service's imports use.
jest.mock('@zetra/citrineos-base', () => {
  const toEnum = (values: string[]) =>
    Object.fromEntries(values.map((v) => [v, v]));
  return new Proxy(
    {
      ConnectorStatusEnum: toEnum([
        'Available',
        'Occupied',
        'Preparing',
        'Charging',
        'SuspendedEVSE',
        'SuspendedEV',
        'Finishing',
        'Reserved',
        'Unavailable',
        'Faulted',
        'Unknown',
      ]),
      HttpMethod: {
        Get: 'GET',
        Post: 'POST',
        Put: 'PUT',
        Patch: 'PATCH',
        Delete: 'DELETE',
      },
      HttpHeader: { Authorization: 'Authorization' },
      LocationHours: class {},
    },
    {
      // any other enum / namespace imported at module load: an empty object
      get: (target: Record<string, unknown>, key: string) =>
        key in target ? target[key] : key === '__esModule' ? true : {},
    },
  );
});

// these import the 00_Base barrel (koa server etc.), not needed here
jest.mock('../../util/CommandExecutor', () => ({ CommandExecutor: class {} }));
jest.mock('../../util/helpers', () => ({
  getTokenOwnerFromAuthorization: jest.fn(),
}));
jest.mock('../TokensService', () => ({ TokensService: class {} }));

import 'reflect-metadata';
import type { ChargingStationDto } from '@zetra/citrineos-base';
import { CommandsService } from '../CommandsService';
import { EvseStatus } from '../../model/EvseStatus';

type Availability = { available: boolean; status: EvseStatus };

// EVSE uid ST1::1 = evseTypeId 1 (EVSE db id 5), one Available connector
const station = (evse: { ocpiStatus?: string | null; removed?: boolean }) =>
  ({
    id: 'ST1',
    evses: [{ id: 5, evseTypeId: 1, ...evse }],
    connectors: [{ id: 11, evseId: 5, status: 'Available' }],
  }) as unknown as ChargingStationDto;

const availability = (cs: ChargingStationDto): Availability =>
  (
    Object.create(CommandsService.prototype) as {
      getEvseAvailabilityForStartSession: (
        cs: ChargingStationDto,
        evseUid: string,
      ) => Availability;
    }
  ).getEvseAvailabilityForStartSession(cs, 'ST1::1');

describe('CommandsService StartSession EVSE availability', () => {
  it('is available when the EVSE has no ocpiStatus and a connector is Available', () => {
    expect(availability(station({ ocpiStatus: null }))).toEqual({
      available: true,
      status: EvseStatus.AVAILABLE,
    });
  });

  it('rejects an EVSE hidden from OCPI (ocpiStatus REMOVED) even if its connector is Available', () => {
    expect(availability(station({ ocpiStatus: 'REMOVED' }))).toEqual({
      available: false,
      status: EvseStatus.REMOVED,
    });
  });

  it('rejects an EVSE that is not live yet (ocpiStatus PLANNED)', () => {
    expect(availability(station({ ocpiStatus: 'PLANNED' }))).toEqual({
      available: false,
      status: EvseStatus.PLANNED,
    });
  });

  it('still rejects an EVSE flagged removed in core', () => {
    expect(availability(station({ removed: true }))).toEqual({
      available: false,
      status: EvseStatus.REMOVED,
    });
  });
});
