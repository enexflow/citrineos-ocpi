// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * eMSP receiver round trip against a real Hasura + real Postgres: a CPO PUTs a
 * Location, then GETs it back. Unlike locationEMSPMapping.test.ts (live stack on
 * :8085, no cleanup possible — hence its RUN_ID suffix), state here is TRUNCATEd
 * between tests, so ids are stable and reruns are deterministic.
 */

// Import the barrel first, the way the Server entrypoint does, so it evaluates
// top-to-bottom before helpers.ts re-enters it. Without this, entering the graph at
// a leaf service leaves SessionsClientApi's `extends BaseClientApi` undefined.
import { startOcpiTestStack } from '../../../../Tests/helpers/setupOcpiTestStack';
import type { OcpiTestStack } from '../../../../Tests/helpers/setupOcpiTestStack';
import { OcpiGraphqlClient } from '../../graphql/OcpiGraphqlClient';
import { LocationReceiverService } from '../LocationReceiverService';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';

const LOCATION_ID = 'LOC-ROUNDTRIP-1';

const locationDto = {
  country_code: 'FR',
  party_id: 'CPO',
  id: LOCATION_ID,
  publish: true,
  name: 'Station Test',
  address: '1 rue de Test',
  city: 'Lyon',
  postal_code: '69000',
  country: 'FRA',
  coordinates: { latitude: '45.7640', longitude: '4.8357' },
  time_zone: 'Europe/Paris',
  evses: [],
  last_updated: '2026-01-01T10:00:00Z',
} as any;

describe('LocationReceiverService — real Hasura round trip', () => {
  let stack: OcpiTestStack;
  let service: LocationReceiverService;
  let tenantPartner: any;

  beforeAll(async () => {
    stack = await startOcpiTestStack();
    const client = new OcpiGraphqlClient(
      stack.graphqlEndpoint,
      stack.graphqlHeaders,
    );
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    service = new LocationReceiverService(logger as any, client);
  });

  afterAll(async () => {
    await stack?.stop();
  });

  beforeEach(async () => {
    await stack.cleanup([
      'ConnectorTariffs',
      'TariffElements',
      'Tariffs',
      'RoamingPartners',
      'Connectors',
      'Evses',
      'ChargingStations',
      'Locations',
      'TenantPartners',
      'Tenants',
    ]);

    // Same identity the seeded FR/CPO direct partner carries — see
    // seeders/20250806120002-default-tenant-partner.ts for the required columns.
    const [tenant] = await stack.sequelize.query(
      `INSERT INTO "Tenants" (name, "isUserTenant", "createdAt", "updatedAt")
       VALUES ('test-tenant', false, now(), now()) RETURNING id`,
      { type: 'SELECT' as any },
    );
    const tenantId = (tenant as any).id;

    const [partner] = await stack.sequelize.query(
      `INSERT INTO "TenantPartners" ("tenantId", "countryCode", "partyId", "createdAt", "updatedAt")
       VALUES (${tenantId}, 'FR', 'CPO', now(), now()) RETURNING id`,
      { type: 'SELECT' as any },
    );

    tenantPartner = {
      id: (partner as any).id,
      tenantId,
      countryCode: 'FR',
      partyId: 'CPO',
      roamingPartners: [],
    };
  });

  it('persists the location to Postgres on PUT', async () => {
    await service.putLocationByCountryPartyAndId(
      'FR',
      'CPO',
      locationDto,
      LOCATION_ID,
      tenantPartner,
    );

    // Read back through SQL, bypassing Hasura: proves the row really landed, and
    // that the columns Hasura wrote are the ones you think they are.
    const rows: any[] = await stack.sequelize.query(
      `SELECT * FROM "Locations" WHERE "ocpiId" = '${LOCATION_ID}'`,
      { type: 'SELECT' as any },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ocpiId: LOCATION_ID,
      ownerTenantPartnerId: tenantPartner.id,
      tenantId: tenantPartner.tenantId,
      city: 'Lyon',
      postalCode: '69000',
      timeZone: 'Europe/Paris',
      publishUpstream: true,
    });
  });

  it('returns that same location on a subsequent GET', async () => {
    await service.putLocationByCountryPartyAndId(
      'FR',
      'CPO',
      locationDto,
      LOCATION_ID,
      tenantPartner,
    );

    const response = await service.getLocationByCountryPartyAndId(
      'FR',
      'CPO',
      LOCATION_ID,
      tenantPartner,
    );

    expect(response.status_code).toBe(1000);
    expect(response.data).toMatchObject({
      id: LOCATION_ID,
      country_code: 'FR',
      party_id: 'CPO',
      city: 'Lyon',
      postal_code: '69000',
    });
  });

  it('is idempotent: a second PUT replaces rather than duplicating', async () => {
    await service.putLocationByCountryPartyAndId(
      'FR',
      'CPO',
      locationDto,
      LOCATION_ID,
      tenantPartner,
    );
    await service.putLocationByCountryPartyAndId(
      'FR',
      'CPO',
      { ...locationDto, city: 'Villeurbanne' },
      LOCATION_ID,
      tenantPartner,
    );

    const rows: any[] = await stack.sequelize.query(
      `SELECT city FROM "Locations" WHERE "ocpiId" = '${LOCATION_ID}'`,
      { type: 'SELECT' as any },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].city).toBe('Villeurbanne');
  });

  it('does not leak a location across partners', async () => {
    await service.putLocationByCountryPartyAndId(
      'FR',
      'CPO',
      locationDto,
      LOCATION_ID,
      tenantPartner,
    );

    const other = { ...tenantPartner, id: tenantPartner.id + 1000 };
    const response = await service.getLocationByCountryPartyAndId(
      'FR',
      'CPO',
      LOCATION_ID,
      other,
    );

    // 2003 ClientUnknownLocation at HTTP 200 — per locationEMSPMapping.test.ts's header.
    expect(response.status_code).toBe(2003);
  });

  /**
   * OCPI tariff ids are only unique per party (country_code + party_id). Behind a
   * hub, several parties share one TenantPartner, so the same ocpiTariffId can exist
   * once per RoamingPartner. Seen in prod: FR*HDA and FR*HDT (both via Gireve) each
   * publish tariff 930818, and FR*HDA connectors were linked to FR*HDT's row because
   * the lookup ignored roamingPartnerId and took Tariffs[0] with no ordering.
   */
  describe('connector tariff linking behind a hub', () => {
    const TARIFF_OCPI_ID = '930818';
    const HUB_LOCATION_ID = 'LOC-HUB-HDA-1';

    let hubPartner: any;
    let hdtTariffId: number;
    let hdaTariffId: number;

    const hdaLocation = (tariffIds: string[]) =>
      ({
        ...locationDto,
        party_id: 'HDA',
        id: HUB_LOCATION_ID,
        evses: [
          {
            uid: 'EVSE-HDA-1',
            evse_id: 'FR*HDA*E1',
            status: 'AVAILABLE',
            connectors: [
              {
                id: '1',
                standard: 'IEC_62196_T2_COMBO',
                format: 'CABLE',
                power_type: 'DC',
                max_voltage: 800,
                max_amperage: 500,
                tariff_ids: tariffIds,
                last_updated: '2026-01-01T10:00:00Z',
              },
            ],
            last_updated: '2026-01-01T10:00:00Z',
          },
        ],
      }) as any;

    const insertTariff = async (roamingPartnerId: number, price: number) => {
      const [row]: any[] = await stack.sequelize.query(
        `INSERT INTO "Tariffs"
           (currency, "ocpiTariffId", "tenantId", "tenantPartnerId", "roamingPartnerId",
            "startDateTime", "createdAt", "updatedAt")
         VALUES ('EUR', '${TARIFF_OCPI_ID}', ${hubPartner.tenantId}, ${hubPartner.id},
                 ${roamingPartnerId}, now(), now(), now())
         RETURNING id`,
        { type: 'SELECT' as any },
      );
      await stack.sequelize.query(
        `INSERT INTO "TariffElements" ("tariffId", "priceComponents", "createdAt", "updatedAt")
         VALUES (${row.id}, '[{"type":"ENERGY","price":${price},"step_size":1}]'::jsonb, now(), now())`,
      );
      return row.id as number;
    };

    const linkedTariffIds = async (): Promise<number[]> => {
      const rows: any[] = await stack.sequelize.query(
        `SELECT ct."tariffId"
           FROM "ConnectorTariffs" ct
           JOIN "Connectors" c ON c.id = ct."connectorId"
           JOIN "ChargingStations" cs ON cs.id = c."stationId"
           JOIN "Locations" l ON l.id = cs."locationId"
          WHERE l."ocpiId" = '${HUB_LOCATION_ID}'`,
        { type: 'SELECT' as any },
      );
      return rows.map((r) => r.tariffId);
    };

    beforeEach(async () => {
      const tenantId = tenantPartner.tenantId;
      const [hub]: any[] = await stack.sequelize.query(
        `INSERT INTO "TenantPartners" ("tenantId", "countryCode", "partyId", "createdAt", "updatedAt")
         VALUES (${tenantId}, 'FR', 'GIR', now(), now()) RETURNING id`,
        { type: 'SELECT' as any },
      );
      const insertRoamingPartner = async (partyId: string) => {
        const [rp]: any[] = await stack.sequelize.query(
          `INSERT INTO "RoamingPartners" ("countryCode", "partyId", "tenantPartnerId", roles)
           VALUES ('FR', '${partyId}', ${hub.id}, '["CPO"]'::jsonb) RETURNING id`,
          { type: 'SELECT' as any },
        );
        return { id: rp.id, countryCode: 'FR', partyId };
      };
      // HDT first, so on the old unscoped lookup its row is the one Postgres
      // returns first: the test fails without the fix instead of passing by luck.
      const hdt = await insertRoamingPartner('HDT');
      const hda = await insertRoamingPartner('HDA');

      hubPartner = {
        id: hub.id,
        tenantId,
        countryCode: 'FR',
        partyId: 'GIR',
        roamingPartners: [hdt, hda],
      };

      hdtTariffId = await insertTariff(hdt.id, 0.45);
      hdaTariffId = await insertTariff(hda.id, 0.3);
    });

    it("links a connector to its own operator's tariff, not another party's with the same id", async () => {
      await service.putLocationByCountryPartyAndId(
        'FR',
        'HDA',
        hdaLocation([TARIFF_OCPI_ID]),
        HUB_LOCATION_ID,
        hubPartner,
      );

      expect(await linkedTariffIds()).toEqual([hdaTariffId]);
    });

    it("refuses to borrow another operator's tariff when its own is missing", async () => {
      await stack.sequelize.query(
        `DELETE FROM "TariffElements" WHERE "tariffId" = ${hdaTariffId};
         DELETE FROM "Tariffs" WHERE id = ${hdaTariffId};`,
      );

      await expect(
        service.putLocationByCountryPartyAndId(
          'FR',
          'HDA',
          hdaLocation([TARIFF_OCPI_ID]),
          HUB_LOCATION_ID,
          hubPartner,
        ),
      ).rejects.toThrow(`Tariff ${TARIFF_OCPI_ID} not found`);

      expect(await linkedTariffIds()).not.toContain(hdtTariffId);
    });
  });
});
