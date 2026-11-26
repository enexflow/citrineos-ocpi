// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Sender Interface GET /locations/:location_id/:evse_uid[/:connector_id],
 * against real Postgres + Hasura (GET_EVSE_BY_ID_QUERY, GET_CONNECTOR_BY_ID_QUERY).
 *
 * The ids must match what we publish:
 *  - evse_uid is UID_FORMAT(stationId, evseTypeId), so the lookup matches
 *    Evses.evseTypeId, not the DB primary key: the EVSE is seeded with
 *    id 50 / evseTypeId 1 to keep the two apart;
 *  - connector_id is Connectors.id (ConnectorMapper), not the OCPP connectorId:
 *    connectors are seeded with ids 101/111 and OCPP connectorIds 1/11.
 * An EVSE hidden from OCPI (Evses.ocpiStatus = REMOVED) is still returned, with
 * status REMOVED whatever its connectors report.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Container } from 'typedi';
import { Logger } from 'tslog';
import { startOcpiTestStack } from '../../../../Tests/helpers/setupOcpiTestStack';
import type { OcpiTestStack } from '../../../../Tests/helpers/setupOcpiTestStack';
import { OcpiGraphqlClient } from '../../graphql/OcpiGraphqlClient';
import { LocationsService } from '../LocationsService';
import { OcpiHeaders } from '../../model/OcpiHeaders';
import { OcpiResponseStatusCode } from '../../model/OcpiResponse';
import { EvseStatus } from '../../model/EvseStatus';

const STATION_ID = 'KEMPOWER-1';
const EVSE_DB_ID = 50;
const EVSE_TYPE_ID = 1;
const CHARGING_CONNECTOR_ID = 101; // OCPP connector 1
const REAL_CONNECTOR_ID = 111; // OCPP connector 11

describe('LocationsService.getEvseById / getConnectorById', () => {
  let stack: OcpiTestStack;
  let service: LocationsService;
  let locationId: number;
  const headers = new OcpiHeaders('FR', 'EMS', 'FR', 'CPO');

  beforeAll(async () => {
    stack = await startOcpiTestStack();
    Container.set(Logger, new Logger({ minLevel: 6 }));

    const client = new OcpiGraphqlClient(
      stack.graphqlEndpoint,
      stack.graphqlHeaders,
    );
    const logger = new Logger({ minLevel: 6 });
    service = new LocationsService(
      logger as never,
      client,
      {} as never,
      {} as never,
    );
  }, 600_000);

  afterAll(async () => {
    await stack?.stop();
  });

  beforeEach(async () => {
    await stack.cleanup([
      'ConnectorTariffs',
      'Tariffs',
      'Connectors',
      'Evses',
      'ChargingStations',
      'Locations',
      'Tenants',
    ]);

    const [t]: any[] = await stack.sequelize.query(
      `INSERT INTO "Tenants" (name, "isUserTenant", "countryCode", "partyId", "createdAt", "updatedAt")
       VALUES ('cpo-tenant', false, 'FR', 'CPO', now(), now()) RETURNING id`,
      { type: 'SELECT' as any },
    );
    const [loc]: any[] = await stack.sequelize.query(
      `INSERT INTO "Locations" ("tenantId", "createdAt", "updatedAt")
       VALUES (${t.id}, now(), now()) RETURNING id`,
      { type: 'SELECT' as any },
    );
    locationId = loc.id;

    await stack.sequelize.query(
      `INSERT INTO "ChargingStations" (id, "locationId", "tenantId", "createdAt", "updatedAt")
       VALUES ('${STATION_ID}', ${locationId}, ${t.id}, now(), now())`,
    );
    await stack.sequelize.query(
      `INSERT INTO "Evses" (id, "tenantId", "stationId", "evseTypeId", "createdAt", "updatedAt")
       VALUES (${EVSE_DB_ID}, ${t.id}, '${STATION_ID}', ${EVSE_TYPE_ID}, now(), now())`,
    );

    // one Charging connector, so the computed EVSE status is CHARGING
    const connector = (id: number, ocppConnectorId: number, status: string) =>
      stack.sequelize.query(
        `INSERT INTO "Connectors"
           (id, "stationId", "evseId", "connectorId", status, type, format, "powerType",
            "maximumVoltage", "maximumAmperage", "tenantId", "createdAt", "updatedAt")
         VALUES (${id}, '${STATION_ID}', ${EVSE_DB_ID}, ${ocppConnectorId}, '${status}',
                 'CHAdeMO', 'Cable', 'DC', 500, 125, ${t.id}, now(), now())`,
      );
    await connector(CHARGING_CONNECTOR_ID, 1, 'Charging');
    await connector(REAL_CONNECTOR_ID, 11, 'Available');

    const [tariff]: any[] = await stack.sequelize.query(
      `INSERT INTO "Tariffs" (currency, "ocpiTariffId", "tenantId", "startDateTime", "createdAt", "updatedAt")
       VALUES ('EUR', 'T1', ${t.id}, now(), now(), now()) RETURNING id`,
      { type: 'SELECT' as any },
    );
    await stack.sequelize.query(
      `INSERT INTO "ConnectorTariffs"
         ("connectorId", "connectorOcpiId", "tariffId", "tariffOcpiId", "tenantId", "createdAt", "updatedAt")
       VALUES (${REAL_CONNECTOR_ID}, '${REAL_CONNECTOR_ID}', ${tariff.id}, 'T1', ${t.id}, now(), now())`,
    );
  });

  it('finds the EVSE by the evseTypeId in its uid and returns its connectors', async () => {
    const res = await service.getEvseById(
      locationId,
      STATION_ID,
      EVSE_TYPE_ID,
      headers,
    );

    expect(res.status_code).toBe(OcpiResponseStatusCode.GenericSuccessCode);
    expect(res.data?.uid).toBe(`${STATION_ID}::${EVSE_TYPE_ID}`);
    expect(
      res.data?.connectors.map((c: { id: string }) => c.id).sort(),
    ).toEqual([String(CHARGING_CONNECTOR_ID), String(REAL_CONNECTOR_ID)]);
    expect(res.data?.status).toBe(EvseStatus.CHARGING);
  });

  it('does not match on the EVSE database id', async () => {
    const res = await service.getEvseById(
      locationId,
      STATION_ID,
      EVSE_DB_ID,
      headers,
    );

    expect(res.status_code).toBe(OcpiResponseStatusCode.ClientUnknownLocation);
  });

  it('returns an OCPI-REMOVED EVSE with status REMOVED, not the computed one', async () => {
    await stack.sequelize.query(
      `UPDATE "Evses" SET "ocpiStatus" = 'REMOVED' WHERE id = ${EVSE_DB_ID}`,
    );

    const res = await service.getEvseById(
      locationId,
      STATION_ID,
      EVSE_TYPE_ID,
      headers,
    );

    expect(res.status_code).toBe(OcpiResponseStatusCode.GenericSuccessCode);
    expect(res.data?.uid).toBe(`${STATION_ID}::${EVSE_TYPE_ID}`);
    // a connector is Charging, the published status must still be REMOVED
    expect(res.data?.status).toBe(EvseStatus.REMOVED);
  });

  describe('getConnectorById', () => {
    const get = (evseTypeId: number, connectorId: number) =>
      service.getConnectorById(
        locationId,
        STATION_ID,
        evseTypeId,
        connectorId,
        headers,
      );

    it('finds the connector by the ids we publish, with its tariff_ids', async () => {
      const res = await get(EVSE_TYPE_ID, REAL_CONNECTOR_ID);

      expect(res.status_code).toBe(OcpiResponseStatusCode.GenericSuccessCode);
      expect(res.data?.id).toBe(String(REAL_CONNECTOR_ID));
      expect(res.data?.tariff_ids).toEqual(['T1']);
    });

    it('does not match on the OCPP connectorId', async () => {
      const res = await get(EVSE_TYPE_ID, 11);

      expect(res.status_code).toBe(
        OcpiResponseStatusCode.ClientUnknownLocation,
      );
    });

    it('does not match on the EVSE database id', async () => {
      const res = await get(EVSE_DB_ID, REAL_CONNECTOR_ID);

      expect(res.status_code).toBe(
        OcpiResponseStatusCode.ClientUnknownLocation,
      );
    });

    it('answers unknown, not a generic error, for a non-numeric connector_id', async () => {
      const res = await get(EVSE_TYPE_ID, Number('abc'));

      expect(res.status_code).toBe(
        OcpiResponseStatusCode.ClientUnknownLocation,
      );
    });
  });
});
