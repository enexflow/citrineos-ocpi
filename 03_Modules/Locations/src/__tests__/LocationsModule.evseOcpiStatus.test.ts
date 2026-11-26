// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Hiding an EVSE from OCPI with Evses.ocpiStatus (REMOVED, or PLANNED for one
 * not live yet) on the Locations push paths:
 *  - an ocpiStatus change is pushed as an EVSE status PATCH (REMOVED / PLANNED
 *    as is, back to null = the status computed from the connectors);
 *  - while it is set, connector status and tariff changes must not push a
 *    computed status that would bring the EVSE back at partners.
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
    // stand-in for the real mapping: CHARGING if any connector charges
    EvseMapper: {
      activeTransactionConnectorIds: jest.fn(() => new Set<number>()),
      mapEvseStatusFromConnectors: jest.fn(
        (connectors: Array<{ status: string }>) =>
          connectors.some((c) => c.status === 'Charging')
            ? 'CHARGING'
            : 'AVAILABLE',
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
import { EvseMapper } from '@citrineos/ocpi-base';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { LocationsModule } from '../index.js';

const tenant = { id: 1, countryCode: 'FR', partyId: 'ZET' };
const STALE_UPDATED_AT = '2026-01-01T00:00:00Z';

// EVSE 5 (uid ST1::1) has a Charging connector, so its computed status is
// CHARGING; EVSE 6 belongs to the same station and must not be mixed in
const station = (evse5OcpiStatus: string | null = null) => ({
  id: 'ST1',
  locationId: 42,
  evses: [
    { id: 5, stationId: 'ST1', evseTypeId: 1, ocpiStatus: evse5OcpiStatus },
    { id: 6, stationId: 'ST1', evseTypeId: 2, ocpiStatus: null },
  ],
  connectors: [
    { id: 11, evseId: 5, status: 'Charging' },
    { id: 12, evseId: 5, status: 'Available' },
    { id: 21, evseId: 6, status: 'Available' },
  ],
  activeTransactions: [],
});

function makeEvent(
  objectType: string,
  payload: object,
  isStatusChanged?: boolean,
): IDtoEvent<any> {
  return {
    _eventId: 'e1',
    _context: { eventType: 'UPDATE', objectType } as any,
    _payload: payload,
    ...(isStatusChanged !== undefined && { isStatusChanged }),
  };
}

describe('LocationsModule EVSE ocpiStatus', () => {
  let mod: LocationsModule;
  let request: jest.Mock;
  let broadcaster: {
    broadcastPatchEvseStatus: jest.Mock;
    broadcastPatchConnectorTariffs: jest.Mock;
    broadcastPatchConnectorTariffsGireve: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
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

  describe('handleEvseUpdate (ocpiStatus change -> EVSE status PATCH)', () => {
    // EvseNotify UPDATE payload: required fields + changed columns only
    const evseEvent = (changed: object) =>
      makeEvent('Evse', {
        id: 5,
        tenantId: 1,
        stationId: 'ST1',
        ocpiUid: null,
        updatedAt: STALE_UPDATED_AT,
        tenant,
        disableOCPI: false,
        ...changed,
      });

    const patchCall = () => {
      expect(broadcaster.broadcastPatchEvseStatus).toHaveBeenCalledTimes(1);
      const [t, evse, lastUpdated, cs, status] =
        broadcaster.broadcastPatchEvseStatus.mock.calls[0];
      return { t, evse, lastUpdated, cs, status };
    };

    it('PATCHes REMOVED, not the status computed from its Charging connector', async () => {
      request.mockResolvedValueOnce({ ChargingStations: [station('REMOVED')] });

      await mod.handleEvseUpdate(evseEvent({ ocpiStatus: 'REMOVED' }));

      expect(request).toHaveBeenCalledWith('GET_CHARGING_STATION_BY_ID_QUERY', {
        id: 'ST1',
      });
      const { t, evse, cs, status } = patchCall();
      expect(status).toBe('REMOVED');
      expect(t).toBe(tenant);
      // the station row's EVSE, which carries the evseTypeId of the OCPI uid
      expect(evse).toMatchObject({ id: 5, stationId: 'ST1', evseTypeId: 1 });
      expect(cs).toMatchObject({ id: 'ST1', locationId: 42 });
      expect(EvseMapper.mapEvseStatusFromConnectors).not.toHaveBeenCalled();
    });

    it('PATCHes PLANNED as is', async () => {
      request.mockResolvedValueOnce({ ChargingStations: [station('PLANNED')] });

      await mod.handleEvseUpdate(evseEvent({ ocpiStatus: 'PLANNED' }));

      expect(patchCall().status).toBe('PLANNED');
    });

    it('back to null: PATCHes the status computed from this EVSE connectors only', async () => {
      request.mockResolvedValueOnce({ ChargingStations: [station(null)] });

      await mod.handleEvseUpdate(evseEvent({ ocpiStatus: null }));

      expect(patchCall().status).toBe('CHARGING');
      const [connectors] = (EvseMapper.mapEvseStatusFromConnectors as jest.Mock)
        .mock.calls[0];
      expect(connectors.map((c: { id: number }) => c.id)).toEqual([11, 12]);
    });

    it('uses a fresh last_updated, not the stale Evses.updatedAt', async () => {
      request.mockResolvedValueOnce({ ChargingStations: [station('REMOVED')] });
      const before = Date.now();

      await mod.handleEvseUpdate(evseEvent({ ocpiStatus: 'REMOVED' }));

      const { lastUpdated } = patchCall();
      expect(lastUpdated).toBeInstanceOf(Date);
      expect(lastUpdated.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('ignores EVSE updates that do not change ocpiStatus', async () => {
      await mod.handleEvseUpdate(evseEvent({ physicalReference: 'A1' }));

      expect(request).not.toHaveBeenCalled();
      expect(broadcaster.broadcastPatchEvseStatus).not.toHaveBeenCalled();
    });

    it('skips when the whole location is OCPI-disabled (disable-location-ocpi PATCHes itself)', async () => {
      await mod.handleEvseUpdate(
        evseEvent({ ocpiStatus: 'REMOVED', disableOCPI: true }),
      );

      expect(request).not.toHaveBeenCalled();
      expect(broadcaster.broadcastPatchEvseStatus).not.toHaveBeenCalled();
    });

    it('skips partner-owned EVSEs', async () => {
      await mod.handleEvseUpdate(
        evseEvent({ ocpiStatus: 'REMOVED', ownerTenantPartner: { id: 7 } }),
      );
      await mod.handleEvseUpdate(
        evseEvent({ ocpiStatus: 'REMOVED', ocpiUid: 'PARTNER-EVSE' }),
      );

      expect(request).not.toHaveBeenCalled();
      expect(broadcaster.broadcastPatchEvseStatus).not.toHaveBeenCalled();
    });

    it('does not PATCH when the EVSE is not on the station', async () => {
      request.mockResolvedValueOnce({ ChargingStations: [station()] });

      await mod.handleEvseUpdate(evseEvent({ id: 99, ocpiStatus: 'REMOVED' }));

      expect(broadcaster.broadcastPatchEvseStatus).not.toHaveBeenCalled();
    });

    it('does not PATCH when the station is not found', async () => {
      request.mockResolvedValueOnce({ ChargingStations: [] });

      await mod.handleEvseUpdate(evseEvent({ ocpiStatus: 'REMOVED' }));

      expect(broadcaster.broadcastPatchEvseStatus).not.toHaveBeenCalled();
    });
  });

  describe('handleConnectorUpdate (connector status -> EVSE status PATCH)', () => {
    const statusEvent = () =>
      makeEvent(
        'Connector',
        {
          id: 11,
          stationId: 'ST1',
          evseId: 5,
          status: 'Charging',
          updatedAt: '2026-11-18T10:00:00Z',
          tenant,
          disableOCPI: false,
        },
        true,
      );

    it.each(['REMOVED', 'PLANNED'])(
      'does not PATCH a computed status over an EVSE with ocpiStatus %s',
      async (ocpiStatus) => {
        request.mockResolvedValueOnce({
          ChargingStations: [station(ocpiStatus)],
        });

        await mod.handleConnectorUpdate(statusEvent());

        expect(broadcaster.broadcastPatchEvseStatus).not.toHaveBeenCalled();
      },
    );

    it('PATCHes the computed status when the EVSE has no ocpiStatus', async () => {
      request.mockResolvedValueOnce({ ChargingStations: [station(null)] });

      await mod.handleConnectorUpdate(statusEvent());

      expect(broadcaster.broadcastPatchEvseStatus).toHaveBeenCalledTimes(1);
      expect(broadcaster.broadcastPatchEvseStatus.mock.calls[0][4]).toBe(
        'CHARGING',
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

    const row = (ocpiStatus: string | null) => ({
      Connectors_by_pk: {
        id: 11,
        evseId: 5,
        stationId: 'ST1',
        updatedAt: '2026-11-18T10:00:00Z',
        tariffs: [{ tariffOcpiId: 'T1' }],
        ChargingStation: {
          locationId: 42,
          Location: { ownerTenantPartnerId: null, disableOCPI: false },
        },
        Evse: { evseTypeId: 1, ocpiStatus, Connectors: [{ id: 11 }] },
      },
    });

    it.each(['REMOVED', 'PLANNED'])(
      'skips both tariff broadcasts on an EVSE with ocpiStatus %s',
      async (ocpiStatus) => {
        request.mockResolvedValueOnce(row(ocpiStatus));

        await mod.handleConnectorTariffChange(tariffEvent());

        expect(
          broadcaster.broadcastPatchConnectorTariffs,
        ).not.toHaveBeenCalled();
        expect(
          broadcaster.broadcastPatchConnectorTariffsGireve,
        ).not.toHaveBeenCalled();
      },
    );

    it('broadcasts when the EVSE has no ocpiStatus', async () => {
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
