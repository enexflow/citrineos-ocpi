// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Connector-level disableOCPI (Connectors.disableOCPI) on the two live
 * Locations push paths: connector status -> EVSE status PATCH, and connector
 * tariff change -> tariff PATCHes. A disabled connector must not be pushed,
 * and must not drive the EVSE status of its enabled siblings.
 */

import 'reflect-metadata';

jest.mock('../module/LocationsModuleApi.js', () => ({
  LocationsModuleApi: class LocationsModuleApiStub {},
}));

jest.mock('@citrineos/ocpi-base', () => {
  const { Token: TypediToken } = require('typedi');

  // handlers are called directly here, so the decorator is a no-op
  const AsDtoEventHandler = () =>
    function (
      _target: object,
      _propertyKey: string,
      descriptor: PropertyDescriptor,
    ): PropertyDescriptor {
      return descriptor;
    };

  class AbstractDtoModule {
    protected _logger: unknown;
    constructor(
      _config: unknown,
      receiver: { module?: unknown },
      logger?: unknown,
    ) {
      this._logger = logger;
      receiver.module = this;
    }
  }

  class RabbitMqDtoReceiver {
    module: unknown;
  }

  return {
    AbstractDtoModule,
    AsDtoEventHandler,
    DtoEventType: { INSERT: 'INSERT', UPDATE: 'UPDATE', DELETE: 'DELETE' },
    DtoEventObjectType: {
      Location: 'Location',
      ChargingStation: 'ChargingStation',
      Evse: 'Evse',
      Connector: 'Connector',
      ConnectorTariff: 'ConnectorTariff',
    },
    // same filtering contract as the real EvseMapper; status itself is
    // covered by LocationMapper.evseStatus.test.ts
    EvseMapper: {
      activeTransactionConnectorIds: jest.fn(() => new Set<number>()),
      mapEvseStatusFromConnectors: jest.fn(
        (connectors: Array<{ status: string; disableOCPI?: boolean }>) => {
          const enabled = connectors.filter((c) => c.disableOCPI !== true);
          return enabled.some((c) => c.status === 'Charging')
            ? 'CHARGING'
            : 'AVAILABLE';
        },
      ),
    },
    GET_CHARGING_STATION_BY_ID_QUERY: 'GET_CHARGING_STATION_BY_ID_QUERY',
    GET_OWN_CONNECTOR_FOR_TARIFF_BROADCAST_QUERY:
      'GET_OWN_CONNECTOR_FOR_TARIFF_BROADCAST_QUERY',
    LocationsBroadcaster: class {},
    OcpiConfigToken: new TypediToken('ocpi.config'),
    OcpiGraphqlClient: class {},
    OcpiModule: class {},
    RabbitMqDtoReceiver,
    logDbBroadcast: jest.fn(),
  };
});

import type { IDtoEvent, OcpiConfig } from '@citrineos/ocpi-base';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { LocationsModule } from '../index.js';

const tenant = { id: 1, countryCode: 'FR', partyId: 'ZET' };

function makeEvent(payload: object, isStatusChanged: boolean): IDtoEvent<any> {
  return {
    _eventId: 'e1',
    _context: { eventType: 'UPDATE', objectType: 'Connector' } as any,
    _payload: payload,
    isStatusChanged,
  };
}

describe('LocationsModule connector disableOCPI', () => {
  let mod: LocationsModule;
  let request: jest.Mock;
  let broadcaster: {
    broadcastPatchEvseStatus: jest.Mock;
    broadcastPatchConnectorTariffs: jest.Mock;
    broadcastPatchConnectorTariffsGireve: jest.Mock;
  };

  beforeEach(() => {
    request = jest.fn();
    broadcaster = {
      broadcastPatchEvseStatus: jest.fn().mockResolvedValue(undefined),
      broadcastPatchConnectorTariffs: jest.fn().mockResolvedValue(undefined),
      broadcastPatchConnectorTariffsGireve: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    mod = new LocationsModule(
      {} as OcpiConfig,
      new Logger<ILogObj>({ type: 'hidden' }),
      broadcaster as never,
      { request } as never,
    );
  });

  describe('handleConnectorUpdate (status -> EVSE status PATCH)', () => {
    // EVSE 5 has phantom connector 1 (disabled) and real connector 11
    const station = {
      id: 'ST1',
      evses: [{ id: 5, evseTypeId: 1 }],
      connectors: [
        { id: 1, evseId: 5, status: 'Charging', disableOCPI: true },
        { id: 11, evseId: 5, status: 'Available', disableOCPI: false },
      ],
      activeTransactions: [],
    };

    const statusEvent = (extra: object) =>
      makeEvent(
        {
          id: 11,
          stationId: 'ST1',
          evseId: 5,
          status: 'Available',
          updatedAt: '2026-11-18T10:00:00Z',
          tenant,
          disableOCPI: false,
          connectorDisableOCPI: false,
          ...extra,
        },
        true,
      );

    it('skips when the connector itself is disabled (connectorDisableOCPI)', async () => {
      await mod.handleConnectorUpdate(
        statusEvent({ id: 1, connectorDisableOCPI: true }),
      );
      expect(request).not.toHaveBeenCalled();
      expect(broadcaster.broadcastPatchEvseStatus).not.toHaveBeenCalled();
    });

    it('skips on the combined disableOCPI key alone', async () => {
      await mod.handleConnectorUpdate(statusEvent({ disableOCPI: true }));
      expect(request).not.toHaveBeenCalled();
      expect(broadcaster.broadcastPatchEvseStatus).not.toHaveBeenCalled();
    });

    it('PATCHes the EVSE status of an enabled connector, ignoring its disabled sibling', async () => {
      request.mockResolvedValueOnce({ ChargingStations: [station] });

      await mod.handleConnectorUpdate(statusEvent({}));

      expect(broadcaster.broadcastPatchEvseStatus).toHaveBeenCalledTimes(1);
      // the disabled sibling is Charging; the published status must not be
      expect(broadcaster.broadcastPatchEvseStatus.mock.calls[0][4]).toBe(
        'AVAILABLE',
      );
    });
  });

  describe('handleConnectorTariffChange (tariff PATCHes)', () => {
    const tariffEvent = (): IDtoEvent<any> => ({
      _eventId: 'e2',
      _context: { eventType: 'UPDATE', objectType: 'ConnectorTariff' } as any,
      _payload: {
        connectorId: 11,
        tenantId: 1,
        tenantPartnerId: null,
        updatedAt: '2026-11-18T10:00:00Z',
        tenant,
      },
    });

    const row = (disableOCPI: boolean | null) => ({
      Connectors_by_pk: {
        id: 11,
        evseId: 5,
        stationId: 'ST1',
        updatedAt: '2026-11-18T10:00:00Z',
        disableOCPI,
        tariffs: [{ tariffOcpiId: 'T1' }],
        ChargingStation: {
          locationId: 42,
          Location: { ownerTenantPartnerId: null, disableOCPI: false },
        },
        Evse: { evseTypeId: 1, Connectors: [{ id: 11 }] },
      },
    });

    it('skips both tariff broadcasts for a disabled connector', async () => {
      request.mockResolvedValueOnce(row(true));

      await mod.handleConnectorTariffChange(tariffEvent());

      expect(broadcaster.broadcastPatchConnectorTariffs).not.toHaveBeenCalled();
      expect(
        broadcaster.broadcastPatchConnectorTariffsGireve,
      ).not.toHaveBeenCalled();
    });

    it('broadcasts for an enabled connector (null = enabled)', async () => {
      request.mockResolvedValueOnce(row(null));

      await mod.handleConnectorTariffChange(tariffEvent());

      expect(broadcaster.broadcastPatchConnectorTariffs).toHaveBeenCalledTimes(
        1,
      );
      expect(
        broadcaster.broadcastPatchConnectorTariffsGireve,
      ).toHaveBeenCalledTimes(1);
    });
  });
});
